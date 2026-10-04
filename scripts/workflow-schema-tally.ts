import { homedir } from 'node:os';

import type { z } from 'zod';

/**
 * Counts, failures, and warnings for `check-workflow-schema.ts`. Everything
 * recorded here is a structure name, a count, a schema issue path and code, or
 * a file:line location, so nothing printed can carry script or prompt content.
 */

export const home = homedir();
export const showAll = process.argv.includes('--all');

export type Finding = {
  category: string;
  line?: number | undefined;
  /** Whether Claude Code itself checks this when it launches a script (`meta`, syntax, determinism). */
  launchCheck?: boolean;
};
export type Groups = Map<string, string[]>;

export const counts = new Map<string, number>();
export const failures: Groups = new Map();
export const warnings: Groups = new Map();

export function count(name: string, amount = 1) {
  if (amount > 0) counts.set(name, (counts.get(name) ?? 0) + amount);
}

export function note(into: Groups, category: string, location: string) {
  into.set(category, [...(into.get(category) ?? []), location]);
}

/** A path with the home directory shortened to `~`. */
export const display = (path: string) =>
  path.startsWith(home) ? `~${path.slice(home.length)}` : path;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Schema issues as `structure: path (code)`, which carry no content. */
export function schemaFindings(structure: string, schema: z.ZodType, value: unknown): Finding[] {
  count(structure);
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    category: `${structure}: ${issue.path.join('.') || '(root)'} (${issue.code})`,
  }));
}

const byName = (left: [string, unknown], right: [string, unknown]) =>
  left[0].localeCompare(right[0]);

function printGroups(title: string, groups: Groups) {
  if (groups.size === 0) return;
  console.log(`\n${title}`);
  for (const [category, locations] of [...groups].toSorted(byName)) {
    console.log(`  ${category}: ${locations.length}`);
    for (const location of showAll ? locations : locations.slice(0, 5))
      console.log(`    ${location}`);
    if (!showAll && locations.length > 5)
      console.log(`    ... ${locations.length - 5} more (--all)`);
  }
}

const total = (groups: Groups) => [...groups.values()].reduce((sum, list) => sum + list.length, 0);

/** Print the report and return the exit code. */
export function printReport(): number {
  console.log('\nChecked');
  for (const [name, amount] of [...counts].toSorted(byName)) console.log(`  ${name}: ${amount}`);
  printGroups('Warnings', warnings);
  printGroups('Failures', failures);
  console.log(`\n${total(failures)} failures, ${total(warnings)} warnings.`);
  return total(failures) === 0 ? 0 : 1;
}
