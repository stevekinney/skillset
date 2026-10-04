/**
 * The counters `check-codex-session-schema.ts` accumulates. Everything here is
 * plain JSON so a worker process can print it and the parent can merge it, and
 * nothing in it is record content: only types, field paths, counts, values of
 * short token-like strings, and file and line locations.
 */

/** How many distinct values one field tracks before it is reported as "many". */
export const distinctValueLimit = 120;

/** How many example locations each failure group keeps. */
export const exampleLimit = 2;

/** A tally of the distinct values one field held; `overflowed` once it passed `distinctValueLimit`. */
export interface ValueTally {
  total: number;
  values: Record<string, number>;
  overflowed: boolean;
}

export interface FailureGroup {
  count: number;
  examples: string[];
}

export interface Statistics {
  files: number;
  lines: number;
  records: number;
  /** Lines that were not JSON at all. */
  invalidJson: FailureGroup & { finalLines: number; filesAffected: number };
  /** Schema failures keyed by `group | issue code | issue path`. */
  failures: Record<string, FailureGroup>;
  /** Keys present in real data that the schema does not name, keyed by `group:path`. */
  unmodeled: Record<string, number>;
  /** Observed values of every `z.string()` field, keyed by `group:path`. */
  strings: Record<string, ValueTally>;
  /** Observed values of every `z.enum`/`z.literal` field. */
  literals: Record<string, ValueTally>;
  /** Values an enum or literal rejected, keyed by `group:path`. */
  rejected: Record<string, ValueTally>;
  /** For open enums (known literals plus any string): values inside and outside the known set. */
  openEnums: Record<string, { known: ValueTally; unknown: ValueTally }>;
  /** Paths the schema leaves loose (`z.unknown()` or `z.record()`), with how often real data reached them. */
  loose: Record<string, number>;
}

export function createStatistics(): Statistics {
  return {
    files: 0,
    lines: 0,
    records: 0,
    invalidJson: { count: 0, examples: [], finalLines: 0, filesAffected: 0 },
    failures: {},
    unmodeled: {},
    strings: {},
    literals: {},
    rejected: {},
    openEnums: {},
    loose: {},
  };
}

export function createTally(): ValueTally {
  return { total: 0, values: {}, overflowed: false };
}

export function addToTally(tally: ValueTally, value: string, count = 1): void {
  tally.total += count;
  if (value in tally.values) {
    tally.values[value] = (tally.values[value] ?? 0) + count;
  } else if (Object.keys(tally.values).length < distinctValueLimit) {
    tally.values[value] = count;
  } else {
    tally.overflowed = true;
  }
}

export function mergeTallies(into: ValueTally, from: ValueTally): void {
  into.total += from.total - sumOf(from.values);
  for (const [value, count] of Object.entries(from.values)) addToTally(into, value, count);
  into.overflowed ||= from.overflowed;
}

function sumOf(values: Record<string, number>): number {
  return Object.values(values).reduce((total, count) => total + count, 0);
}

export function tallyFor(map: Record<string, ValueTally>, key: string): ValueTally {
  return (map[key] ??= createTally());
}

export function increment(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export function addFailure(
  map: Record<string, FailureGroup>,
  key: string,
  location: string,
  by = 1,
): void {
  const group = (map[key] ??= { count: 0, examples: [] });
  group.count += by;
  if (group.examples.length < exampleLimit && !group.examples.includes(location)) {
    group.examples.push(location);
  }
}

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, count] of Object.entries(from)) increment(into, key, count);
}

function mergeTallyMaps(into: Record<string, ValueTally>, from: Record<string, ValueTally>): void {
  for (const [key, tally] of Object.entries(from)) mergeTallies(tallyFor(into, key), tally);
}

export function mergeStatistics(into: Statistics, from: Statistics): void {
  into.files += from.files;
  into.lines += from.lines;
  into.records += from.records;
  into.invalidJson.count += from.invalidJson.count;
  into.invalidJson.finalLines += from.invalidJson.finalLines;
  into.invalidJson.filesAffected += from.invalidJson.filesAffected;
  for (const example of from.invalidJson.examples) {
    if (into.invalidJson.examples.length < exampleLimit) into.invalidJson.examples.push(example);
  }
  for (const [key, group] of Object.entries(from.failures)) {
    for (const example of group.examples) addFailure(into.failures, key, example, 0);
    (into.failures[key] ??= { count: 0, examples: [] }).count += group.count;
  }
  mergeCounts(into.unmodeled, from.unmodeled);
  mergeCounts(into.loose, from.loose);
  mergeTallyMaps(into.strings, from.strings);
  mergeTallyMaps(into.literals, from.literals);
  mergeTallyMaps(into.rejected, from.rejected);
  for (const [key, open] of Object.entries(from.openEnums)) {
    const target = (into.openEnums[key] ??= { known: createTally(), unknown: createTally() });
    mergeTallies(target.known, open.known);
    mergeTallies(target.unknown, open.unknown);
  }
}

/** A value is safe to print when it looks like an enum token, never like prose, a path, or an identifier. */
export function isPrintableToken(value: string): boolean {
  return value.length <= 40 && /^[A-Za-z0-9_.:-]+$/.test(value) && !/^[0-9a-f-]{20,}$/i.test(value);
}

/** Whether every tracked value of a tally is a printable token. */
export function isPrintableTally(tally: ValueTally): boolean {
  return !tally.overflowed && Object.keys(tally.values).every(isPrintableToken);
}

/** Field names are printed; keys that look like data (paths, identifiers) are not. */
export function safeKey(key: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key)) return '<uuid>';
  return /^[A-Za-z0-9_$.:@-]{1,60}$/.test(key) ? key : '<data-key>';
}

/** Checks a worker's JSON really is statistics before merging it. */
export function isStatistics(value: unknown): value is Statistics {
  return (
    typeof value === 'object' &&
    value !== null &&
    'records' in value &&
    'failures' in value &&
    'unmodeled' in value &&
    'invalidJson' in value
  );
}
