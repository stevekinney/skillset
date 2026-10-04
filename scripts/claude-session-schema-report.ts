import type { ExpectedLoosePath } from './claude-session-schema-expected.js';
import { showable, type FailureGroup } from './claude-session-schema-failures.js';
import type { StringStatistics, WalkStatistics } from './claude-session-schema-walker.js';
import { DISTINCT_CAP } from './claude-session-schema-walker.js';

/** Everything the checker collected, ready to print. */
export interface Report {
  files: number;
  lines: number;
  parsed: number;
  invalidJson: Map<string, FailureGroup>;
  /** An unterminated last line: a write in progress or cut short. Reported, not a failure. */
  truncatedTails: Map<string, FailureGroup>;
  failures: Map<string, FailureGroup>;
  /** Record counts by label (`type`, `system{subtype}`, `attachment{type}`). */
  seen: Map<string, number>;
  statistics: WalkStatistics;
  /** The record types the schema models. */
  schemaLabels: string[];
}

export interface ReportOptions {
  expectedLoose: ExpectedLoosePath[];
  allStrings: boolean;
}

/** Strings longer than this many distinct values are treated as open; no values are listed. */
const CLOSED_SET_LIMIT = 25;
/** Values are printed only below this many distinct values, and only when they look like tokens. */
const PRINT_LIMIT = 12;
/** Field names whose values are identifiers, text or paths: never printed, however few. */
const PRIVATE_NAME =
  /(id|uuid|path|cwd|branch|slug|name|title|text|content|prompt|message|command|url|email|summary|description|label|key|hash|pid|commit|sha|date|timestamp|chain|from|session|repository)$/i;
/** A field is a closed-set candidate only when its values repeat: this many records per distinct value. */
const REPEAT_FACTOR = 4;

function sorted<T>(map: Map<string, T>, count: (value: T) => number): [string, T][] {
  return [...map.entries()].toSorted(
    (a, b) => count(b[1]) - count(a[1]) || a[0].localeCompare(b[0]),
  );
}

function printGroups(title: string, groups: Map<string, FailureGroup>): number {
  let total = 0;
  console.log(`\n${title}: ${groups.size} group(s)`);
  for (const [key, group] of sorted(groups, (value) => value.count)) {
    total += group.count;
    console.log(`  ${String(group.count).padStart(8)}  ${key}`);
    console.log(`            e.g. ${group.examples.join(', ')}`);
    if (group.values.size > 0) {
      const values = sorted(group.values, (value) => value).map(([value, n]) => `${value} x${n}`);
      console.log(`            values: ${values.slice(0, 10).join(', ')}`);
    }
  }
  return total;
}

function printSeen(report: Report) {
  console.log('\nrecords seen (by type):');
  const byType = new Map<string, number>();
  for (const [label, count] of report.seen) {
    const type = label.replace(/\{.*$/, '');
    byType.set(type, (byType.get(type) ?? 0) + count);
  }
  for (const [type, count] of sorted(byType, (value) => value))
    console.log(`  ${String(count).padStart(8)}  ${type}`);
  const unseen = report.schemaLabels.filter((type) => !byType.has(type));
  console.log(`modeled but never seen (${unseen.length}): ${unseen.join(', ') || '(none)'}`);
}

function printUnmodeled(statistics: WalkStatistics): number {
  console.log(`\nunmodeled fields: ${statistics.unmodeled.size} path(s)`);
  for (const [path, count] of sorted(statistics.unmodeled, (value) => value))
    console.log(`  ${String(count).padStart(8)}  ${path}`);
  return statistics.unmodeled.size;
}

function printLoose(statistics: WalkStatistics, expected: ExpectedLoosePath[]): number {
  const unexpected: [string, number][] = [];
  const reasons = new Map<string, number>();
  for (const [path, count] of statistics.loose) {
    const match = expected.find((entry) => entry.pattern.test(path));
    if (match) reasons.set(match.reason, (reasons.get(match.reason) ?? 0) + count);
    else unexpected.push([path, count]);
  }
  console.log(`\ndeliberately loose (hits by reason):`);
  for (const [reason, count] of sorted(reasons, (value) => value))
    console.log(`  ${String(count).padStart(8)}  ${reason}`);
  console.log(`\nloose spots with no documented reason: ${unexpected.length}`);
  for (const [path, count] of unexpected) console.log(`  ${String(count).padStart(8)}  ${path}`);
  const unused = expected.filter(
    (entry) => ![...statistics.loose.keys()].some((path) => entry.pattern.test(path)),
  );
  if (unused.length > 0)
    console.log(
      `documented loose patterns never hit: ${unused.map((entry) => entry.pattern.source).join(' ; ')}`,
    );
  return unexpected.length;
}

function printFallbacks(statistics: WalkStatistics) {
  console.log(
    `\nunions that matched only the catch-all record (path | tool): ${statistics.fallbacks.size}`,
  );
  for (const [key, count] of sorted(statistics.fallbacks, (value) => value).slice(0, 60))
    console.log(`  ${String(count).padStart(8)}  ${key}`);
}

function describeStrings(path: string, entry: StringStatistics): string | undefined {
  const distinct = entry.values.size;
  const open =
    entry.overflowed ||
    entry.long > 0 ||
    distinct > CLOSED_SET_LIMIT ||
    entry.total < distinct * REPEAT_FACTOR;
  if (open) return undefined;
  const values = [...entry.values.entries()].toSorted((a, b) => b[1] - a[1]);
  const printable =
    distinct <= PRINT_LIMIT &&
    !PRIVATE_NAME.test(path.replace(/\[\]$/, '')) &&
    values.every(([value]) => showable(value));
  const list = printable
    ? values.map(([value, n]) => `${value} x${n}`).join(', ')
    : '(values withheld)';
  return `${path}  total ${entry.total}, distinct ${distinct}: ${list}`;
}

function printStrings(statistics: WalkStatistics, all: boolean) {
  const open: string[] = [];
  const candidates: string[] = [];
  for (const [path, entry] of statistics.strings) {
    const line = describeStrings(path, entry);
    if (line) candidates.push(line);
    else {
      const distinct = entry.overflowed ? `>${DISTINCT_CAP}` : String(entry.values.size);
      open.push(`${path}  total ${entry.total}, distinct ${distinct}, long ${entry.long}`);
    }
  }
  console.log(`\nstring fields that look like small closed sets (${candidates.length}):`);
  for (const line of candidates.toSorted()) console.log(`  ${line}`);
  console.log(
    `\nstring fields that are open (${open.length})${all ? ':' : ' (rerun with --all-strings to list)'}`,
  );
  if (all) for (const line of open.toSorted()) console.log(`  ${line}`);
}

/**
 * Literal unions are only as good as the evidence behind them: list the
 * members no real record has used. They stay when the API, the binary or the
 * docs define them, and are the first suspects if a union looks wrong.
 */
function printEnums(statistics: WalkStatistics) {
  const lines: string[] = [];
  let complete = 0;
  for (const [path, entry] of statistics.enums) {
    const unseen = entry.members.filter((member) => !entry.seen.has(member));
    if (unseen.length === 0) complete += 1;
    else
      lines.push(
        `${path}  seen ${entry.members.length - unseen.length}/${entry.members.length}, never seen: ${unseen.join(', ')}`,
      );
  }
  console.log(
    `\nliteral unions: ${statistics.enums.size} field(s) reached; ${complete} use every member; ${lines.length} have members never seen`,
  );
  for (const line of lines.toSorted()) console.log(`  ${line}`);
}

/** Print the report and return the process exit code: non-zero when anything is wrong. */
export function printReport(report: Report, options: ReportOptions): number {
  console.log(`files ${report.files}, lines ${report.lines}, records parsed ${report.parsed}`);
  printSeen(report);
  const invalid = printGroups('lines that are not JSON objects', report.invalidJson);
  printGroups(
    'unterminated last lines (a write in progress; not counted as failures)',
    report.truncatedTails,
  );
  const failed = printGroups('records that fail their schema', report.failures);
  const unmodeled = printUnmodeled(report.statistics);
  const unexplained = printLoose(report.statistics, options.expectedLoose);
  printFallbacks(report.statistics);
  printEnums(report.statistics);
  printStrings(report.statistics, options.allStrings);
  console.log(
    `\nsummary: ${invalid} non-object line(s), ${failed} schema failure(s), ${unmodeled} unmodeled path(s), ${unexplained} undocumented loose spot(s)`,
  );
  return invalid + failed + unmodeled + unexplained > 0 ? 1 : 0;
}
