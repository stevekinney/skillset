import {
  addToTally,
  createTally,
  increment,
  safeKey,
  tallyFor,
  type Statistics,
} from './statistics.js';

/* oxlint-disable no-underscore-dangle -- Zod 4 exposes a schema's definition only as `_zod`. */

/**
 * Walks a Zod schema and a real value side by side, recording what a plain
 * `safeParse` cannot say: object keys the schema never names, every value a
 * `z.string()` field held, every value a literal or enum field held, and which
 * `z.unknown()`/`z.record()` paths real data reached.
 *
 * It reads Zod 4's `_zod.def` internals, so it is a development tool, not
 * published code.
 */

interface SchemaNode {
  _zod: { def: Definition; propValues?: Record<string, Set<unknown>> };
}

interface Definition {
  type: string;
  shape?: Record<string, SchemaNode>;
  options?: SchemaNode[];
  discriminator?: string;
  element?: SchemaNode;
  innerType?: SchemaNode;
  valueType?: SchemaNode;
  entries?: Record<string, string>;
  values?: unknown[];
  getter?: () => SchemaNode;
}

type Plain = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaNode(value: unknown): value is SchemaNode {
  return (
    isPlainObject(value) && isPlainObject(value['_zod']) && isPlainObject(value['_zod']['def'])
  );
}

function definitionOf(schema: unknown): Definition {
  if (!isSchemaNode(schema)) throw new TypeError('Expected a Zod 4 schema.');
  return schema._zod.def;
}

const wrapperTypes = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch']);

/** Walk `value` against `schema`, adding findings under `group`:`path`. */
export function walkSchema(
  schema: unknown,
  value: unknown,
  path: string,
  group: string,
  statistics: Statistics,
): void {
  const definition = definitionOf(schema);
  const key = `${group}:${path}`;
  if (wrapperTypes.has(definition.type)) {
    if (value === undefined || (value === null && definition.type === 'nullable')) return;
    if (definition.innerType) walkSchema(definition.innerType, value, path, group, statistics);
    return;
  }
  walkNode(definition, value, path, group, key, statistics);
}

function walkNode(
  definition: Definition,
  value: unknown,
  path: string,
  group: string,
  key: string,
  statistics: Statistics,
): void {
  switch (definition.type) {
    case 'object':
      walkObject(definition, value, path, group, statistics);
      return;
    case 'array':
      if (Array.isArray(value) && definition.element) {
        for (const item of value)
          walkSchema(definition.element, item, `${path}[]`, group, statistics);
      }
      return;
    case 'record':
      walkRecord(definition, value, path, group, key, statistics);
      return;
    case 'union':
      walkUnion(definition, value, path, group, key, statistics);
      return;
    case 'lazy':
      if (definition.getter) walkSchema(definition.getter(), value, path, group, statistics);
      return;
    default:
      walkLeaf(definition, value, key, statistics);
  }
}

function walkObject(
  definition: Definition,
  value: unknown,
  path: string,
  group: string,
  statistics: Statistics,
): void {
  if (!isPlainObject(value) || !definition.shape) return;
  for (const [name, child] of Object.entries(value)) {
    const shape = definition.shape[name];
    if (shape) walkSchema(shape, child, `${path}.${name}`, group, statistics);
    else increment(statistics.unmodeled, `${group}:${path}.${safeKey(name)}`);
  }
}

function walkRecord(
  definition: Definition,
  value: unknown,
  path: string,
  group: string,
  key: string,
  statistics: Statistics,
): void {
  if (!isPlainObject(value)) return;
  increment(statistics.loose, key);
  const valueType = definition.valueType;
  if (valueType && definitionOf(valueType).type !== 'unknown') {
    for (const child of Object.values(value))
      walkSchema(valueType, child, `${path}.*`, group, statistics);
  }
}

function walkLeaf(
  definition: Definition,
  value: unknown,
  key: string,
  statistics: Statistics,
): void {
  if (definition.type === 'string' && typeof value === 'string') {
    addToTally(tallyFor(statistics.strings, key), value);
  } else if (definition.type === 'unknown' || definition.type === 'any') {
    increment(statistics.loose, key);
  } else if (definition.type === 'enum' || definition.type === 'literal') {
    const known = literalValuesOf(definition);
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value);
      addToTally(
        tallyFor(known.includes(value) ? statistics.literals : statistics.rejected, key),
        text,
      );
    }
  }
}

function literalValuesOf(definition: Definition): unknown[] {
  return definition.type === 'enum'
    ? Object.values(definition.entries ?? {})
    : (definition.values ?? []);
}

function walkUnion(
  definition: Definition,
  value: unknown,
  path: string,
  group: string,
  key: string,
  statistics: Statistics,
): void {
  const options = definition.options ?? [];
  if (definition.discriminator) {
    const option = pickByDiscriminator(options, definition.discriminator, value);
    if (option) walkSchema(option, value, path, group, statistics);
    return;
  }
  const openEnum = findOpenEnum(options);
  if (openEnum && typeof value === 'string') {
    const target = (statistics.openEnums[key] ??= { known: createTally(), unknown: createTally() });
    const isKnown = literalValuesOf(definitionOf(openEnum)).includes(value);
    addToTally(isKnown ? target.known : target.unknown, value);
    return;
  }
  const option = pickByShape(options, value);
  if (option) walkSchema(option, value, path, group, statistics);
}

function pickByDiscriminator(
  options: SchemaNode[],
  discriminator: string,
  value: unknown,
): SchemaNode | undefined {
  if (!isPlainObject(value)) return undefined;
  const tag = value[discriminator];
  return options.find((option) => option._zod.propValues?.[discriminator]?.has(tag));
}

/** A union of an enum and a plain string is an "open enum": known values plus anything else. */
function findOpenEnum(options: SchemaNode[]): SchemaNode | undefined {
  const types = options.map((option) => definitionOf(option).type);
  return types.length === 2 && types.includes('string') && types.includes('enum')
    ? options[types.indexOf('enum')]
    : undefined;
}

function pickByShape(options: SchemaNode[], value: unknown): SchemaNode | undefined {
  const wanted = shapeKind(value);
  const candidates = options.filter((option) => kindMatches(definitionOf(option), wanted, value));
  if (candidates.length <= 1 || !isPlainObject(value)) return candidates[0];
  return mostOverlapping(candidates, Object.keys(value));
}

function shapeKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : typeof value;
}

function kindMatches(definition: Definition, wanted: string, value: unknown): boolean {
  if (wanted === 'object') return definition.type === 'object' || definition.type === 'record';
  if (wanted === 'string' && definition.type === 'enum') {
    return literalValuesOf(definition).includes(value);
  }
  if (wanted === 'string') return definition.type === 'string' || definition.type === 'literal';
  return definition.type === wanted || (wanted === 'null' && definition.type === 'nullable');
}

function mostOverlapping(candidates: SchemaNode[], keys: string[]): SchemaNode | undefined {
  const score = (option: SchemaNode) =>
    keys.filter((name) => definitionOf(option).shape && name in (definitionOf(option).shape ?? {}))
      .length;
  return candidates.toSorted((left, right) => score(right) - score(left))[0];
}
