import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverAgents, discoverSkills, discoverSources, resolveSourceRoot } from './discover.js';

const temporaryDirectories: string[] = [];

async function makeRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'skillset-discover-'));
  temporaryDirectories.push(directory);

  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('resolveSourceRoot', () => {
  it('prefers SKILLSET_DIRECTORY when set', () => {
    expect(resolveSourceRoot('/custom', '/work')).toBe('/custom');
  });

  it('falls back to the working directory', () => {
    expect(resolveSourceRoot(undefined, '/work')).toBe('/work');
  });
});

describe('discoverSkills', () => {
  it('returns empty for a missing directory', async () => {
    expect(await discoverSkills('/nowhere/skills')).toEqual([]);
  });

  it('finds skills, ignores non-skill entries, and lists supporting files', async () => {
    const root = await makeRoot();

    await mkdir(join(root, 'zeta'));
    await writeFile(join(root, 'zeta', 'SKILL.md'), 'zeta skill');
    await mkdir(join(root, 'alpha', 'references'), { recursive: true });
    await writeFile(join(root, 'alpha', 'SKILL.md'), 'alpha skill');
    await writeFile(join(root, 'alpha', 'references', 'notes.md'), 'notes');
    await writeFile(join(root, 'alpha', 'run.sh'), 'echo hi');
    await mkdir(join(root, 'not-a-skill'));
    await writeFile(join(root, 'stray-file.md'), 'stray');

    const skills = await discoverSkills(root);

    expect(skills.map((skill) => skill.name)).toEqual(['alpha', 'zeta']);
    expect(skills[0]?.raw).toBe('alpha skill');
    expect(skills[0]?.supportingFiles).toEqual([join('references', 'notes.md'), 'run.sh']);
    expect(skills[1]?.supportingFiles).toEqual([]);
  });
});

describe('discoverAgents', () => {
  it('returns empty for a missing directory', async () => {
    expect(await discoverAgents('/nowhere/agents')).toEqual([]);
  });

  it('finds .md files sorted and ignores everything else', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'zeta.md'), 'zeta agent');
    await writeFile(join(root, 'alpha.md'), 'alpha agent');
    await writeFile(join(root, 'notes.txt'), 'not an agent');
    await mkdir(join(root, 'subdir'));

    const agents = await discoverAgents(root);
    expect(agents.map((agent) => agent.name)).toEqual(['alpha', 'zeta']);
    expect(agents[0]?.raw).toBe('alpha agent');
    expect(agents[0]?.path).toBe(join(root, 'alpha.md'));
  });
});

describe('discoverSources', () => {
  it('collects all three kinds', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'skills', 'demo'), { recursive: true });
    await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), 'skill');
    await mkdir(join(root, 'agents'));
    await writeFile(join(root, 'agents', 'reviewer.md'), 'agent');
    await writeFile(join(root, 'mcp-servers.yaml'), 'servers: {}');

    const sources = await discoverSources(root);
    expect(sources.root).toBe(root);
    expect(sources.skills.map((skill) => skill.name)).toEqual(['demo']);
    expect(sources.agents.map((agent) => agent.name)).toEqual(['reviewer']);
    expect(sources.mcp?.raw).toBe('servers: {}');
  });

  it('tolerates missing kinds as long as one exists', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'agents'));

    const sources = await discoverSources(root);
    expect(sources.skills).toEqual([]);
    expect(sources.agents).toEqual([]);
    expect(sources.mcp).toBeUndefined();
  });

  it('throws when no source kind exists at all', async () => {
    const root = await makeRoot();
    expect(discoverSources(root)).rejects.toThrow('no sources found');
  });
});
