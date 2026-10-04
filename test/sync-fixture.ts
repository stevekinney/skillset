import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseAgentFile } from '../src/agent-frontmatter.js';
import type { SourceAgent, SourceSkill } from '../src/discover.js';
import { parseSkillFile } from '../src/frontmatter.js';
import type { Ledger } from '../src/ledger.js';
import type { CompilableSources, SyncOptions } from '../src/sync.js';
import { resolveTargets, type Targets } from '../src/targets.js';

/**
 * Temporary targets and sources for sync tests. Each test file registers
 * `removeSyncFixtures` with its own `afterEach`.
 */
const temporaryDirectories: string[] = [];

export async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

export async function makeTargets(): Promise<Targets> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-sync-'));
  temporaryDirectories.push(base);

  return resolveTargets('user', join(base, 'home'), base);
}

export function freshLedger(): Ledger {
  return { version: 2, items: {} };
}

/** A new temporary directory, removed by `removeSyncFixtures`. */
export async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

export async function removeSyncFixtures(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export const skillRaw = '---\nname: demo\ndescription: A demo.\n---\n\nBody.\n';
export const agentRaw = '---\nname: reviewer\ndescription: Reviews.\n---\n\nYou review.\n';

export async function makeSources(): Promise<CompilableSources> {
  const directory = await mkdtemp(join(tmpdir(), 'skillset-source-'));
  temporaryDirectories.push(directory);

  await writeFile(join(directory, 'SKILL.md'), skillRaw);
  const skill: SourceSkill = { name: 'demo', directory, raw: skillRaw, supportingFiles: [] };
  const agent: SourceAgent = {
    name: 'reviewer',
    path: join(directory, 'reviewer.md'),
    raw: agentRaw,
  };

  return {
    skills: [{ source: skill, parsed: parseSkillFile(skillRaw) }],
    agents: [{ source: agent, parsed: parseAgentFile(agentRaw) }],
    instructions: 'Be helpful.\n',
  };
}

export const options: SyncOptions = {
  targets: ['claude', 'codex'],
  kinds: ['skill', 'agent', 'instructions'],
  prune: false,
  force: false,
};
