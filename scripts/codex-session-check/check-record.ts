import type { core } from 'zod';

import { codexSessionRecordSchema } from '../../src/codex-session-records.js';
import { addFailure, type Statistics } from './statistics.js';
import { isPlainObject, walkSchema } from './walk-schema.js';

/**
 * The `group` a record belongs to: its `type`, its `payload.type`, and for
 * `item_completed` events the type of the item, so findings read like
 * `event_msg/item_completed/FileChange`.
 */
export function groupOf(record: unknown): string {
  if (!isPlainObject(record)) return '?';
  const payload = record['payload'];
  const parts = [String(record['type'])];
  if (isPlainObject(payload) && typeof payload['type'] === 'string') {
    parts.push(payload['type']);
    const item = payload['item'];
    if (payload['type'] === 'item_completed' && isPlainObject(item))
      parts.push(String(item['type']));
  }
  return parts.join('/');
}

interface FlatIssue {
  code: string;
  path: PropertyKey[];
}

/** Array indices become `[]` so the same mistake in every element is one group. */
function formatIssuePath(path: PropertyKey[]): string {
  return path.map((part) => (typeof part === 'number' ? '[]' : `.${String(part)}`)).join('') || '.';
}

/**
 * Flattens Zod's issue tree. A union failure carries one issue list per
 * option; the option with the fewest issues is the nearest miss, so only it is
 * kept.
 */
function flattenIssues(issues: readonly core.$ZodIssue[], prefix: PropertyKey[] = []): FlatIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    const flat = { code: issue.code, path };
    if (issue.code !== 'invalid_union') return [flat];
    const nearest = issue.errors.toSorted((left, right) => left.length - right.length)[0] ?? [];
    return [flat, ...flattenIssues(nearest, path)];
  });
}

function recordFailures(
  issues: readonly core.$ZodIssue[],
  group: string,
  location: string,
  statistics: Statistics,
): void {
  const seen = new Set<string>();
  for (const issue of flattenIssues(issues)) {
    const key = `${group} | ${issue.code} | ${formatIssuePath(issue.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addFailure(statistics.failures, key, location);
  }
}

/** Parse one JSON value as a rollout record and walk it, recording everything. */
export function checkRecord(record: unknown, location: string, statistics: Statistics): void {
  statistics.records++;
  const group = groupOf(record);
  const result = codexSessionRecordSchema.safeParse(record);
  if (!result.success) recordFailures(result.error.issues, group, location, statistics);
  walkSchema(codexSessionRecordSchema, record, '', group, statistics);
}
