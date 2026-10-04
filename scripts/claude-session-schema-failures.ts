import type { z } from 'zod';

/**
 * Groups schema failures for the session-schema checker. It reports record
 * types, field paths, issue codes, counts and file:line locations, and the
 * offending value only when it is a short identifier-like token (an enum
 * member the schema lacks). Nothing else from a record is ever printed.
 */

/** A value is shown only when it reads as a short enum-like token, never as an id, date, path or text. */
const TOKEN = /^[A-Za-z][A-Za-z0-9_.:\-[\]]{0,31}$/;
const LOOKS_LIKE_IDENTIFIER =
  /\d{4}|[0-9a-f]{8}-[0-9a-f]{4}|^[0-9a-f]{12,}$|^[A-Za-z]+_[0-9A-Za-z]{16,}$/i;
const MAX_EXAMPLES = 2;

export function showable(value: string): boolean {
  return TOKEN.test(value) && !LOOKS_LIKE_IDENTIFIER.test(value);
}

type Issue = z.core.$ZodIssue;

export interface FailureGroup {
  count: number;
  examples: string[];
  /** Offending short tokens for `invalid_value` issues, with counts. */
  values: Map<string, number>;
}

/** Render an issue path with array indexes collapsed: `message.content[].text`. */
export function renderPath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === 'number' ? '[]' : `.${String(part)}`)).join('');
}

function isIndexable(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function valueAt(record: unknown, path: readonly PropertyKey[]): unknown {
  let current = record;
  for (const part of path) {
    if (!isIndexable(current)) return undefined;
    current = current[part];
  }
  return current;
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function depthOf(branch: readonly Issue[]): number {
  return branch[0]?.path.length ?? 0;
}

/** A union failure hides the real cause one level down; surface the deepest branch. */
function flatten(issues: readonly Issue[]): Issue[] {
  return issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union') return [issue];
    const deepest = issue.errors.reduce<readonly Issue[]>(
      (best, branch) => (depthOf(branch) > depthOf(best) ? branch : best),
      issue.errors[0] ?? [],
    );
    return deepest.length > 0 ? flatten(deepest) : [issue];
  });
}

function describe(issue: Issue, record: unknown): { key: string; token?: string } {
  const path = renderPath(issue.path);
  const found = valueAt(record, issue.path);
  if (issue.code === 'invalid_value') {
    const token = typeof found === 'string' && showable(found) ? found : `<${kindOf(found)}>`;
    return { key: `${path} [invalid_value]`, token };
  }
  if (issue.code === 'invalid_type') {
    return { key: `${path} [invalid_type: expected ${issue.expected}, got ${kindOf(found)}]` };
  }
  return { key: `${path} [${issue.code}]` };
}

/** Record a line that could not be used at all (not JSON, or JSON that is not an object). */
export function addLineFailure(groups: Map<string, FailureGroup>, label: string, location: string) {
  let group = groups.get(label);
  if (!group) {
    group = { count: 0, examples: [], values: new Map() };
    groups.set(label, group);
  }
  group.count += 1;
  if (group.examples.length < MAX_EXAMPLES) group.examples.push(location);
}

/** Record every issue of one failed record into the grouped failures. */
export function addFailure(
  groups: Map<string, FailureGroup>,
  label: string,
  location: string,
  record: unknown,
  issues: readonly Issue[],
) {
  for (const issue of flatten(issues)) {
    const { key, token } = describe(issue, record);
    const groupKey = `${label} ${key}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { count: 0, examples: [], values: new Map() };
      groups.set(groupKey, group);
    }
    group.count += 1;
    if (group.examples.length < MAX_EXAMPLES && !group.examples.includes(location))
      group.examples.push(location);
    if (token !== undefined) group.values.set(token, (group.values.get(token) ?? 0) + 1);
  }
}
