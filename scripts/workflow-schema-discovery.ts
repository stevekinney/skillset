import { readdir, realpath } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { home } from './workflow-schema-tally.js';

/**
 * Finds every workflow file on this machine: saved scripts (a session's
 * `workflows/scripts`, `~/.claude/workflows`, and every `.claude/workflows`
 * beneath the scanned roots), the `wf_<id>.json` run records, and the session
 * transcripts that hold `Workflow` tool calls.
 */

export const claudeDirectory = process.env['CLAUDE_CONFIG_DIR'] ?? join(home, '.claude');
const skippedDirectories = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache']);

export type Discovered = {
  /** `session` marks a script the runtime saved beside a run rather than a saved command. */
  scripts: Array<{ path: string; session: boolean }>;
  records: string[];
  transcripts: string[];
  /** Files in a workflows directory the runtime skips: `.mjs`, `.cjs`, and `.ts`. */
  nearMisses: number;
};

async function children(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Every `.claude/workflows` directory beneath `root`, not descending into dependencies. */
async function workflowDirectories(root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const found: string[] = [];
  for (const entry of await children(root)) {
    if (!entry.isDirectory() || skippedDirectories.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.name === 'workflows' && basename(root) === '.claude') found.push(path);
    else found.push(...(await workflowDirectories(path, depth + 1)));
  }
  return found;
}

async function nestedTranscripts(directory: string): Promise<string[]> {
  const transcripts: string[] = [];
  for (const entry of await children(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) transcripts.push(...(await nestedTranscripts(path)));
    else if (entry.name.endsWith('.jsonl') && entry.name !== 'journal.jsonl')
      transcripts.push(path);
  }
  return transcripts;
}

async function scanSessions(found: Discovered, directories: Map<string, boolean>) {
  const projects = join(claudeDirectory, 'projects');
  for (const project of await children(projects))
    for (const session of await children(join(projects, project.name))) {
      const path = join(projects, project.name, session.name);
      if (session.isFile() && session.name.endsWith('.jsonl')) found.transcripts.push(path);
      // Subagents' and workflow agents' transcripts live below the session
      // directory; their Workflow calls count too. Journals are a different format.
      if (session.isDirectory()) found.transcripts.push(...(await nestedTranscripts(path)));
      directories.set(join(path, 'workflows', 'scripts'), true);
      for (const entry of await children(join(path, 'workflows')))
        if (/^wf_.*\.json$/.test(entry.name))
          found.records.push(join(path, 'workflows', entry.name));
    }
}

export async function discover(roots: string[]): Promise<Discovered> {
  const found: Discovered = { scripts: [], records: [], transcripts: [], nearMisses: 0 };
  const directories = new Map<string, boolean>([[join(claudeDirectory, 'workflows'), false]]);
  for (const root of roots)
    for (const path of await workflowDirectories(root)) directories.set(path, false);
  await scanSessions(found, directories);

  const seen = new Set<string>();
  for (const [directory, session] of directories)
    for (const entry of await children(directory)) {
      const path = entry.isFile() ? await realpath(join(directory, entry.name)) : undefined;
      if (path === undefined || seen.has(path)) continue;
      seen.add(path);
      if (extname(entry.name) === '.js') found.scripts.push({ path, session });
      else found.nearMisses += 1;
    }
  return found;
}
