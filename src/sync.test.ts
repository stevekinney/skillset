import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GENERATED_MARKER_TOML } from './agent-emit.js';
import { parseAgentFile } from './agent-frontmatter.js';
import type { SourceAgent, SourceSkill } from './discover.js';
import { GENERATED_MARKER } from './emit.js';
import { parseSkillFile } from './frontmatter.js';
import { hashContent, type Ledger } from './ledger.js';
import {
  agentFileName,
  executeSync,
  hasDrifted,
  planSync,
  type CompilableSources,
  type SyncOptions,
} from './sync.js';
import { resolveTargets, type Targets } from './targets.js';

const temporaryDirectories: string[] = [];

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

async function makeTargets(): Promise<Targets> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-sync-'));
  temporaryDirectories.push(base);

  return resolveTargets('user', join(base, 'home'), base);
}

function freshLedger(): Ledger {
  return { version: 2, items: {} };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const skillRaw = '---\nname: demo\ndescription: A demo.\n---\n\nBody.\n';
const agentRaw = '---\nname: reviewer\ndescription: Reviews.\n---\n\nYou review.\n';

async function makeSources(): Promise<CompilableSources> {
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

const options: SyncOptions = {
  targets: ['claude', 'codex'],
  kinds: ['skill', 'agent', 'instructions'],
  prune: false,
  force: false,
};

describe('agentFileName', () => {
  it('is .md for Claude and .toml for Codex', () => {
    expect(agentFileName('reviewer', 'claude')).toBe('reviewer.md');
    expect(agentFileName('reviewer', 'codex')).toBe('reviewer.toml');
  });
});

describe('hasDrifted', () => {
  it('is false when there is nothing recorded or every recorded file matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillset-drifted-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'SKILL.md'), 'contents');

    expect(await hasDrifted(root, undefined)).toBe(false);
    expect(await hasDrifted(root, { files: { 'SKILL.md': hashContent('contents') } })).toBe(false);
  });

  it('is true when a recorded file is missing or changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillset-drifted-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'SKILL.md'), 'edited');

    expect(await hasDrifted(root, { files: { 'SKILL.md': hashContent('original') } })).toBe(true);
    expect(await hasDrifted(root, { files: { 'MISSING.md': hashContent('x') } })).toBe(true);
  });
});

describe('planSync', () => {
  it('plans writes for every kind into empty roots', async () => {
    const targets = await makeTargets();
    const actions = await planSync(await makeSources(), targets, freshLedger(), options);

    expect(actions.map((action) => `${action.target}:${action.kind}:${action.action}`)).toEqual([
      'claude:skill:write',
      'claude:agent:write',
      'claude:instructions:write',
      'codex:skill:write',
      'codex:agent:write',
      'codex:instructions:write',
    ]);
    expect(actions[2]?.path).toBe(targets.claude.instructions);
    expect(actions[4]?.path).toBe(join(targets.codex.agents, 'reviewer.toml'));
  });

  it('skips unmanaged targets and recognizes both marker forms', async () => {
    const targets = await makeTargets();
    await mkdir(join(targets.claude.skills, 'demo'), { recursive: true });
    await writeFile(join(targets.claude.skills, 'demo', 'SKILL.md'), 'hand-written');
    await mkdir(targets.codex.agents, { recursive: true });
    await writeFile(
      join(targets.codex.agents, 'reviewer.toml'),
      `${GENERATED_MARKER_TOML}\nname = "reviewer"\n`,
    );

    const actions = await planSync(await makeSources(), targets, freshLedger(), {
      ...options,
      kinds: ['skill', 'agent'],
    });
    const byKey = new Map(
      actions.map((action) => [`${action.target}:${action.kind}`, action.action]),
    );
    expect(byKey.get('claude:skill')).toBe('skip-unmanaged');
    expect(byKey.get('codex:agent')).toBe('overwrite');
  });

  it('flags drift via ledger hashes and overwrites with force', async () => {
    const targets = await makeTargets();
    const sources = await makeSources();
    const ledger = freshLedger();

    await executeSync(sources, await planSync(sources, targets, ledger, options), ledger, 'user');

    const compiled = join(targets.claude.skills, 'demo', 'SKILL.md');
    await writeFile(compiled, `${await readFile(compiled, 'utf8')}\nhand edit`);

    const drifted = await planSync(sources, targets, ledger, {
      ...options,
      targets: ['claude'],
      kinds: ['skill'],
    });
    expect(drifted[0]?.action).toBe('skip-drifted');

    const forced = await planSync(sources, targets, ledger, {
      ...options,
      targets: ['claude'],
      kinds: ['skill'],
      force: true,
    });
    expect(forced[0]?.action).toBe('overwrite');
  });

  it('treats marker-only targets without ledger entries as managed', async () => {
    const targets = await makeTargets();
    await mkdir(join(targets.claude.skills, 'demo'), { recursive: true });
    await writeFile(join(targets.claude.skills, 'demo', 'SKILL.md'), `x\n${GENERATED_MARKER}\n`);

    const actions = await planSync(await makeSources(), targets, freshLedger(), {
      ...options,
      targets: ['claude'],
      kinds: ['skill'],
    });
    expect(actions[0]?.action).toBe('overwrite');
  });

  it('prunes managed orphans of every kind, never unmanaged ones', async () => {
    const targets = await makeTargets();
    await mkdir(join(targets.claude.skills, 'stale'), { recursive: true });
    await writeFile(join(targets.claude.skills, 'stale', 'SKILL.md'), `x\n${GENERATED_MARKER}\n`);
    await mkdir(targets.claude.agents, { recursive: true });
    await writeFile(join(targets.claude.agents, 'old.md'), `x\n${GENERATED_MARKER}\n`);
    await writeFile(join(targets.claude.agents, 'mine.md'), 'hand-written');
    await mkdir(join(targets.claude.instructions, '..'), { recursive: true });
    await writeFile(targets.claude.instructions, `${GENERATED_MARKER}\nOld instructions.`);

    const sources = await makeSources();
    delete sources.instructions;

    const actions = await planSync(sources, targets, freshLedger(), {
      ...options,
      targets: ['claude'],
      prune: true,
    });
    const prunes = actions.filter((action) => action.action === 'prune');
    expect(prunes.map((action) => `${action.kind}:${action.name}`)).toEqual([
      'skill:stale',
      'agent:old',
      'instructions:instructions',
    ]);
  });
});

describe('executeSync', () => {
  it('writes all kinds and records ledger entries with hashes', async () => {
    const targets = await makeTargets();
    const sources = await makeSources();
    const ledger = freshLedger();

    await executeSync(sources, await planSync(sources, targets, ledger, options), ledger, 'user');

    const instructions = await readFile(targets.claude.instructions, 'utf8');
    expect(instructions).toContain(GENERATED_MARKER);
    expect(instructions).toContain('Be helpful.');

    const item = ledger.items[join(targets.claude.skills, 'demo')];
    expect(item?.kind).toBe('skill');
    expect(item?.scope).toBe('user');
    expect(item?.syncedAt).not.toBe('');

    const compiled = await readFile(join(targets.claude.skills, 'demo', 'SKILL.md'), 'utf8');
    expect(item?.entry).toMatchObject({ files: { 'SKILL.md': hashContent(compiled) } });
  });

  it('prunes remove both the target and the ledger entry', async () => {
    const targets = await makeTargets();
    const sources = await makeSources();
    const ledger = freshLedger();
    await executeSync(sources, await planSync(sources, targets, ledger, options), ledger, 'user');

    const emptied: CompilableSources = { skills: [], agents: [] };
    const actions = await planSync(emptied, targets, ledger, { ...options, prune: true });
    await executeSync(emptied, actions, ledger, 'user');

    expect(await exists(join(targets.claude.skills, 'demo'))).toBe(false);
    expect(await exists(targets.claude.instructions)).toBe(false);
    expect(Object.keys(ledger.items)).toEqual([]);
  });

  it('leaves skipped targets untouched', async () => {
    const targets = await makeTargets();
    await mkdir(targets.claude.agents, { recursive: true });
    await writeFile(join(targets.claude.agents, 'reviewer.md'), 'hand-written');

    const sources = await makeSources();
    const ledger = freshLedger();
    const actions = await planSync(sources, targets, ledger, {
      ...options,
      targets: ['claude'],
      kinds: ['agent'],
    });
    await executeSync(sources, actions, ledger, 'user');

    expect(await readFile(join(targets.claude.agents, 'reviewer.md'), 'utf8')).toBe('hand-written');
  });

  it('copies supporting files for skills', async () => {
    const targets = await makeTargets();
    const sources = await makeSources();
    const skill = sources.skills[0]!;
    await mkdir(join(skill.source.directory, 'references'), { recursive: true });
    await writeFile(join(skill.source.directory, 'references', 'notes.md'), 'notes');
    skill.source.supportingFiles = [join('references', 'notes.md')];

    const ledger = freshLedger();
    await executeSync(
      sources,
      await planSync(sources, targets, ledger, {
        ...options,
        targets: ['claude'],
        kinds: ['skill'],
      }),
      ledger,
      'user',
    );

    expect(
      await readFile(join(targets.claude.skills, 'demo', 'references', 'notes.md'), 'utf8'),
    ).toBe('notes');
  });
});
