import type { z } from 'zod';

/**
 * Walks a parsed value alongside the Zod schema that accepted it, recording
 * what a plain parse cannot see: object keys the schema never names (a loose
 * object lets them through silently), the places the schema deliberately
 * stops describing (`z.unknown()`, `z.record(z.string(), z.unknown())`), and
 * what the string-typed fields actually hold.
 *
 * It reads Zod's own `_zod.def` structure, so it is tied to Zod 4's internals;
 * the `Definition` type below names the few members it relies on.
 */

type Schema = z.ZodType;

interface Definition {
  type: string;
  shape?: Record<string, Schema>;
  innerType?: Schema;
  element?: Schema;
  valueType?: Schema;
  options?: Schema[];
  discriminator?: string;
  in?: Schema;
  getter?: () => Schema;
  entries?: Record<string, string | number>;
}

type PropertyValues = Record<string, Set<unknown> | undefined>;

/** How many distinct short values a string field tracks before it is called open. */
export const DISTINCT_CAP = 200;
/** Strings longer than this are free text; they are counted but never kept. */
export const SHORT_STRING = 40;

export interface StringStatistics {
  total: number;
  long: number;
  overflowed: boolean;
  values: Map<string, number>;
}

/** Everything one walk accumulates, merged across every record. */
export interface WalkStatistics {
  /** Keys present in the data that the schema does not name, by path. */
  unmodeled: Map<string, number>;
  /** Object or array values that landed on a schema that stops describing them, by path. */
  loose: Map<string, number>;
  /** Union members that matched only the catch-all record, by `path | tool`. */
  fallbacks: Map<string, number>;
  /** Observed values of every string-typed field, by path. */
  strings: Map<string, StringStatistics>;
  /** The values every literal-union (`z.enum`) field has taken, by path, beside its full member list. */
  enums: Map<string, EnumStatistics>;
}

export interface EnumStatistics {
  members: string[];
  seen: Map<string, number>;
}

export function emptyStatistics(): WalkStatistics {
  return {
    unmodeled: new Map(),
    loose: new Map(),
    fallbacks: new Map(),
    strings: new Map(),
    enums: new Map(),
  };
}

function bump(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function definitionOf(schema: Schema): Definition {
  const definition: Definition = schema['_zod'].def;
  return definition;
}

function propertyValues(schema: Schema): PropertyValues {
  return schema['_zod'].propValues ?? {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The context a walk carries that is not part of the schema: which tool produced a result. */
export interface WalkContext {
  toolName: string | undefined;
}

type Walk = (
  schema: Schema,
  value: unknown,
  path: string,
  statistics: WalkStatistics,
  context: WalkContext,
) => void;

function recordString(statistics: WalkStatistics, path: string, value: string) {
  let entry = statistics.strings.get(path);
  if (!entry) {
    entry = { total: 0, long: 0, overflowed: false, values: new Map() };
    statistics.strings.set(path, entry);
  }
  entry.total += 1;
  if (value.length > SHORT_STRING) {
    entry.long += 1;
    return;
  }
  const seen = entry.values.get(value);
  if (seen !== undefined) entry.values.set(value, seen + 1);
  else if (entry.values.size < DISTINCT_CAP) entry.values.set(value, 1);
  else entry.overflowed = true;
}

/** Pick the union member that accepts the value, by discriminator or by trying each. */
function selectOption(definition: Definition, value: unknown): Schema | undefined {
  const options = definition.options ?? [];
  const discriminator = definition.discriminator;
  if (discriminator !== undefined && isObject(value)) {
    return options.find((option) =>
      propertyValues(option)[discriminator]?.has(value[discriminator]),
    );
  }
  return options.find((option) => option.safeParse(value).success);
}

const wrappers = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'nonoptional',
]);

/** Handlers for the schema kinds that hold other schemas. */
const handlers: Record<string, (definition: Definition, ...rest: Parameters<Walk>) => void> = {
  object(definition, _schema, value, path, statistics, context) {
    if (!isObject(value)) return;
    const shape = definition.shape ?? {};
    for (const [key, child] of Object.entries(value)) {
      const known = shape[key];
      if (known) walkValue(known, child, `${path}.${key}`, statistics, context);
      else bump(statistics.unmodeled, `${path}.${key}`);
    }
  },
  array(definition, _schema, value, path, statistics, context) {
    if (!Array.isArray(value) || !definition.element) return;
    for (const element of value)
      walkValue(definition.element, element, `${path}[]`, statistics, context);
  },
  record(definition, _schema, value, path, statistics, context) {
    if (!isObject(value) || !definition.valueType) return;
    if (definitionOf(definition.valueType).type === 'unknown') {
      bump(statistics.loose, path);
      return;
    }
    for (const child of Object.values(value))
      walkValue(definition.valueType, child, `${path}.<key>`, statistics, context);
  },
  union(definition, _schema, value, path, statistics, context) {
    const option = selectOption(definition, value);
    if (!option) return;
    const optionDefinition = definitionOf(option);
    if (optionDefinition.type === 'record')
      bump(statistics.fallbacks, `${path} | ${context.toolName ?? '(unknown tool)'}`);
    const label =
      definition.discriminator !== undefined && isObject(value)
        ? `{${String(value[definition.discriminator])}}`
        : '';
    walkValue(option, value, `${path}${label}`, statistics, context);
  },
  pipe(definition, _schema, value, path, statistics, context) {
    if (definition.in) walkValue(definition.in, value, path, statistics, context);
  },
  lazy(definition, _schema, value, path, statistics, context) {
    if (definition.getter) walkValue(definition.getter(), value, path, statistics, context);
  },
  enum(definition, _schema, value, path, statistics) {
    if (typeof value !== 'string') return;
    let entry = statistics.enums.get(path);
    if (!entry) {
      entry = { members: Object.values(definition.entries ?? {}).map(String), seen: new Map() };
      statistics.enums.set(path, entry);
    }
    bump(entry.seen, value);
  },
  string(_definition, _schema, value, path, statistics) {
    if (typeof value === 'string') recordString(statistics, path, value);
  },
  unknown(_definition, _schema, value, path, statistics) {
    if (typeof value === 'object' && value !== null) bump(statistics.loose, path);
  },
};

/** Walk `value` alongside `schema`, accumulating into `statistics`. */
export const walkValue: Walk = (schema, value, path, statistics, context) => {
  const definition = definitionOf(schema);
  if (wrappers.has(definition.type)) {
    if (value === undefined || (value === null && definition.type === 'nullable')) return;
    if (definition.innerType) walkValue(definition.innerType, value, path, statistics, context);
    return;
  }
  handlers[definition.type]?.(definition, schema, value, path, statistics, context);
};
