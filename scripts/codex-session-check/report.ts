import { openStringFields } from './open-string-fields.js';
import {
  isPrintableTally,
  type FailureGroup,
  type Statistics,
  type ValueTally,
} from './statistics.js';

/** A string field with at most this many distinct values is a candidate closed set. */
const closedSetCandidateLimit = 30;

/** Fewer observations than this say nothing about whether a set is closed. */
const closedSetMinimumObservations = 20;

function sortedEntries<Value>(map: Record<string, Value>, weigh: (value: Value) => number) {
  return Object.entries(map).toSorted(
    ([leftKey, left], [rightKey, right]) =>
      weigh(right) - weigh(left) || leftKey.localeCompare(rightKey),
  );
}

/** Identifiers are never printed, however short their tally. */
const identifierPath = /(?:_id|Id|\.id|_ids|_hash)(?:\[\])?$/;

function printable(key: string, tally: ValueTally): boolean {
  return !identifierPath.test(key) && isPrintableTally(tally);
}

function describeValues(key: string, tally: ValueTally): string {
  if (!printable(key, tally)) return '(withheld: not short enum-like tokens)';
  const entries = sortedEntries(tally.values, (count) => count);
  return entries.map(([value, count]) => `${value}=${count}`).join(' ');
}

function failureLines(failures: Record<string, FailureGroup>): string[] {
  return sortedEntries(failures, (group) => group.count).flatMap(([key, group]) => [
    `  ${group.count}x ${key}`,
    ...group.examples.map((example) => `      e.g. ${example}`),
  ]);
}

function openEnumLines(statistics: Statistics): string[] {
  const lines: string[] = [];
  for (const [key, open] of sortedEntries(statistics.openEnums, (entry) => entry.unknown.total)) {
    if (open.unknown.total === 0) continue;
    const distinct = Object.keys(open.unknown.values).length;
    lines.push(
      `  ${key}: ${open.unknown.total} values outside the known set, ${distinct}${open.unknown.overflowed ? '+' : ''} distinct; ${describeValues(key, open.unknown)}`,
    );
  }
  return lines;
}

function closedSetLines(statistics: Statistics): {
  candidates: string[];
  open: string[];
  many: number;
  tokenless: number;
} {
  const candidates: string[] = [];
  const open: string[] = [];
  let many = 0;
  let tokenless = 0;
  for (const [key, tally] of sortedEntries(statistics.strings, (entry) => entry.total)) {
    const distinct = Object.keys(tally.values).length;
    const reason = openStringFields.find(([pattern]) => pattern.test(key))?.[1];
    if (tally.overflowed || distinct > closedSetCandidateLimit) many++;
    else if (reason)
      open.push(`  ${key}: ${distinct} distinct in ${tally.total}; open because ${reason}`);
    else if (!printable(key, tally)) tokenless++;
    else if (tally.total >= closedSetMinimumObservations) {
      candidates.push(
        `  ${key}: ${distinct} distinct in ${tally.total}; ${describeValues(key, tally)}`,
      );
    }
  }
  return { candidates, open, many, tokenless };
}

function section(title: string, lines: string[], empty = '  none'): string[] {
  return ['', title, ...(lines.length > 0 ? lines : [empty])];
}

export interface Report {
  text: string;
  failed: boolean;
}

/**
 * Renders the findings. The check fails (exit code 1) when a record fails to
 * parse or real data carries a key the schema does not name; the other
 * sections are information for deciding what to model next.
 */
export function renderReport(statistics: Statistics): Report {
  const failureCount = Object.values(statistics.failures).reduce(
    (sum, group) => sum + group.count,
    0,
  );
  const unmodeled = sortedEntries(statistics.unmodeled, (count) => count).map(
    ([key, count]) => `  ${count}x ${key}`,
  );
  const rejected = sortedEntries(statistics.rejected, (tally) => tally.total).map(
    ([key, tally]) => `  ${key}: ${tally.total} rejected; ${describeValues(key, tally)}`,
  );
  const sets = closedSetLines(statistics);
  const loose = sortedEntries(statistics.loose, (count) => count).map(
    ([key, count]) => `  ${count}x ${key}`,
  );
  const text = [
    `Checked ${statistics.files} files, ${statistics.lines} lines, ${statistics.records} records.`,
    ...section(
      `Lines that are not JSON: ${statistics.invalidJson.count} in ${statistics.invalidJson.filesAffected} files, ${statistics.invalidJson.finalLines} of them the last line of their file (reported, not a schema failure)`,
      statistics.invalidJson.examples.map((example) => `  e.g. ${example}`),
      '  none',
    ),
    ...section(`1. Parse failures: ${failureCount} records`, failureLines(statistics.failures)),
    ...section(`2. Unmodeled fields: ${unmodeled.length} paths`, unmodeled),
    ...section('3a. Values rejected by a literal or enum', rejected),
    ...section('3b. Open-enum values outside the known set', openEnumLines(statistics)),
    ...section(
      `3c. String fields that may be closed sets (at most ${closedSetCandidateLimit} distinct values, ${sets.many} other string fields have more, ${sets.tokenless} hold ids, paths or prose)`,
      sets.candidates,
    ),
    ...section('3d. String fields deliberately left open', sets.open),
    ...section(`Loose paths real data reached: ${loose.length}`, loose),
  ].join('\n');
  return { text, failed: failureCount > 0 || unmodeled.length > 0 || rejected.length > 0 };
}
