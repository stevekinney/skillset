import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

// Directory links are junctions on Windows, which need no special privilege.
const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir';

describe('symlinked sources', () => {
  it('discovers a skill directory and an agent file that are symlinks', async () => {
    const root = await makeRoot();
    const elsewhere = join(root, 'elsewhere');
    await mkdir(join(elsewhere, 'linked-skill'), { recursive: true });
    await writeFile(
      join(elsewhere, 'linked-skill', 'SKILL.md'),
      '---\nname: linked-skill\ndescription: d\n---\nBody.\n',
    );
    await writeFile(
      join(elsewhere, 'linked-agent.md'),
      '---\nname: linked-agent\ndescription: d\n---\nPrompt.\n',
    );
    await mkdir(join(root, 'skills'), { recursive: true });
    await mkdir(join(root, 'agents'), { recursive: true });
    await symlink(
      join(elsewhere, 'linked-skill'),
      join(root, 'skills', 'linked-skill'),
      directoryLinkType,
    );
    await symlink(join(elsewhere, 'linked-agent.md'), join(root, 'agents', 'linked-agent.md'));

    // A broken link is skipped rather than failing discovery.
    await symlink(join(elsewhere, 'missing'), join(root, 'skills', 'broken'), directoryLinkType);
    const skills = await discoverSkills(join(root, 'skills'));
    expect(skills.map((skill) => skill.name)).toEqual(['linked-skill']);
    const agents = await discoverAgents(join(root, 'agents'));
    expect(agents.map((agent) => agent.name)).toEqual(['linked-agent']);
  });

  it('collects files inside a symlinked subdirectory, and stops at a cycle', async () => {
    const root = await makeRoot();
    const skill = join(root, 'skills', 'demo');
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nBody.\n');
    await mkdir(join(root, 'shared'), { recursive: true });
    await writeFile(join(root, 'shared', 'notes.md'), 'notes');
    await symlink(join(root, 'shared'), join(skill, 'references'), directoryLinkType);
    await symlink(skill, join(skill, 'loop'), directoryLinkType);

    const [discovered] = await discoverSkills(join(root, 'skills'));
    expect(
      discovered?.supportingFiles.map((file) => file.replaceAll('\\', '/')).toSorted(),
    ).toEqual(['references/notes.md']);
  });
});

describe('symlink aliases and unreadable targets', () => {
  it('collects every alias of the same directory, since an alias is not a cycle', async () => {
    const root = await makeRoot();
    const skill = join(root, 'skills', 'demo');
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nBody.\n');
    await mkdir(join(root, 'shared'), { recursive: true });
    await writeFile(join(root, 'shared', 'notes.md'), 'notes');
    await symlink(join(root, 'shared'), join(skill, 'first'), directoryLinkType);
    await symlink(join(root, 'shared'), join(skill, 'second'), directoryLinkType);

    const [discovered] = await discoverSkills(join(root, 'skills'));
    const files = discovered?.supportingFiles.map((file) => file.replaceAll('\\', '/')).toSorted();
    expect(files).toEqual(['first/notes.md', 'second/notes.md']);
  });

  it('surfaces a target it cannot read, instead of treating it as a broken link', async () => {
    // POSIX permissions only: Windows has no mode bits to deny.
    if (process.platform === 'win32') return;
    const root = await makeRoot();
    await mkdir(join(root, 'agents'), { recursive: true });
    await mkdir(join(root, 'locked'), { recursive: true });
    await writeFile(
      join(root, 'locked', 'agent.md'),
      '---\nname: agent\ndescription: d\n---\nPrompt.\n',
    );
    await symlink(join(root, 'locked', 'agent.md'), join(root, 'agents', 'agent.md'));
    await chmod(join(root, 'locked'), 0o000);
    try {
      const failure = await discoverAgents(join(root, 'agents')).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(Error);
    } finally {
      await chmod(join(root, 'locked'), 0o755);
    }
  });
});
