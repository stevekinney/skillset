import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GENERATED_MARKER_TOML } from './agent-emit.js';
import { GENERATED_MARKER } from './emit.js';
import { importSource } from './import.js';
import { resolveTargets, type Targets } from './targets.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeFixture(): Promise<{ root: string; targets: Targets }> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-import-'));
  temporaryDirectories.push(base);
  const root = join(base, 'sources');
  await mkdir(root, { recursive: true });

  return { root, targets: resolveTargets('user', join(base, 'home'), base) };
}

describe('importSource', () => {
  it('imports a claude skill, stripping the marker and copying supporting files', async () => {
    const { root, targets } = await makeFixture();
    const installed = join(targets.claude.skills, 'legacy');
    await mkdir(join(installed, 'references'), { recursive: true });
    await writeFile(
      join(installed, 'SKILL.md'),
      `---\nname: legacy\ndescription: Old.\n---\n\n${GENERATED_MARKER}\n\nBody.\n`,
    );
    await writeFile(join(installed, 'references', 'notes.md'), 'notes');

    const path = await importSource(
      { kind: 'skill', name: 'legacy', from: 'claude' },
      root,
      targets,
    );
    expect(path).toBe(join(root, 'skills', 'legacy', 'SKILL.md'));

    const source = await readFile(path, 'utf8');
    expect(source).not.toContain(GENERATED_MARKER);
    expect(source).toContain('Body.');
    expect(await readFile(join(root, 'skills', 'legacy', 'references', 'notes.md'), 'utf8')).toBe(
      'notes',
    );
  });

  it('imports a codex skill, folding openai.yaml into the frontmatter', async () => {
    const { root, targets } = await makeFixture();
    const installed = join(targets.codex.skills, 'ported');
    await mkdir(join(installed, 'agents'), { recursive: true });
    await writeFile(
      join(installed, 'SKILL.md'),
      '---\nname: ported\ndescription: P.\n---\n\nBody.\n',
    );
    await writeFile(
      join(installed, 'agents', 'openai.yaml'),
      'interface:\n  display_name: Ported\n',
    );
    await writeFile(join(installed, 'run.sh'), 'echo hi');

    const path = await importSource(
      { kind: 'skill', name: 'ported', from: 'codex' },
      root,
      targets,
    );
    const source = await readFile(path, 'utf8');
    expect(source).toContain('display_name: Ported');
    expect(source).toContain('openai:');
    expect(await readFile(join(root, 'skills', 'ported', 'run.sh'), 'utf8')).toBe('echo hi');
  });

  it('imports agents from both tools', async () => {
    const { root, targets } = await makeFixture();
    await mkdir(targets.claude.agents, { recursive: true });
    await writeFile(
      join(targets.claude.agents, 'rev.md'),
      '---\nname: rev\ndescription: R.\n---\n\nYou review.\n',
    );
    await mkdir(targets.codex.agents, { recursive: true });
    await writeFile(
      join(targets.codex.agents, 'helper.toml'),
      `${GENERATED_MARKER_TOML}\nname = "helper"\ndescription = "H."\nmodel = "gpt-5.6-luna"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nYou help.\n"""\n`,
    );

    const claudePath = await importSource(
      { kind: 'agent', name: 'rev', from: 'claude' },
      root,
      targets,
    );
    expect(await readFile(claudePath, 'utf8')).toContain('You review.');

    const codexPath = await importSource(
      { kind: 'agent', name: 'helper', from: 'codex' },
      root,
      targets,
    );
    const source = await readFile(codexPath, 'utf8');
    expect(source).toContain('name: helper');
    expect(source).toContain('model: gpt-5.6-luna');
    expect(source).toContain('sandbox_mode: read-only');
    expect(source).toContain('You help.');
  });

  it('imports instructions from either tool', async () => {
    const { root, targets } = await makeFixture();
    await mkdir(join(targets.codex.instructions, '..'), { recursive: true });
    await writeFile(targets.codex.instructions, `${GENERATED_MARKER}\n\nAgents guidance.\n`);

    const path = await importSource({ kind: 'instructions', from: 'codex' }, root, targets);
    expect(path).toBe(join(root, 'instructions.md'));
    const source = await readFile(path, 'utf8');
    expect(source).toContain('Agents guidance.');
    expect(source).not.toContain(GENERATED_MARKER);
  });

  it('refuses duplicates, missing origins, and invalid TOML agents', async () => {
    const { root, targets } = await makeFixture();

    expect(
      importSource({ kind: 'skill', name: 'nope', from: 'claude' }, root, targets),
    ).rejects.toThrow('no claude skill named');
    expect(
      importSource({ kind: 'agent', name: 'nope', from: 'codex' }, root, targets),
    ).rejects.toThrow('no codex agent named');
    expect(importSource({ kind: 'instructions', from: 'claude' }, root, targets)).rejects.toThrow(
      'no instructions file',
    );
    expect(importSource({ kind: 'skill', from: 'claude' }, root, targets)).rejects.toThrow(
      'requires a <name>',
    );

    await mkdir(join(root, 'skills', 'taken'), { recursive: true });
    await writeFile(join(root, 'skills', 'taken', 'SKILL.md'), 'x');
    expect(
      importSource({ kind: 'skill', name: 'taken', from: 'claude' }, root, targets),
    ).rejects.toThrow('already exists');

    await mkdir(targets.codex.agents, { recursive: true });
    await writeFile(join(targets.codex.agents, 'bare.toml'), 'model = "x"\n');
    expect(
      importSource({ kind: 'agent', name: 'bare', from: 'codex' }, root, targets),
    ).rejects.toThrow('missing the required name/description');
  });
});
