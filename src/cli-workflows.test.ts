import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli, type CliDependencies } from './cli.js';
import { GENERATED_MARKER } from './emit.js';

const temporaryDirectories: string[] = [];

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type Fixture = {
  dependencies: CliDependencies;
  lines: string[];
  root: string;
  home: string;
};

async function makeFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-cli-'));
  temporaryDirectories.push(base);

  const home = join(base, 'home');
  await mkdir(join(base, 'skills'), { recursive: true });
  await mkdir(home, { recursive: true });

  const lines: string[] = [];

  return {
    root: base,
    home,
    lines,
    dependencies: {
      cwd: base,
      env: { NODE_ENV: 'test' },
      homeDirectory: home,
      log: (line) => lines.push(line),
    },
  };
}

async function addSkill(fixture: Fixture, name: string, raw: string): Promise<void> {
  await mkdir(join(fixture.root, 'skills', name), { recursive: true });
  await writeFile(join(fixture.root, 'skills', name, 'SKILL.md'), raw);
}

async function addAgent(fixture: Fixture, name: string, raw: string): Promise<void> {
  await mkdir(join(fixture.root, 'agents'), { recursive: true });
  await writeFile(join(fixture.root, 'agents', `${name}.md`), raw);
}

const validSkill = '---\nname: demo\ndescription: A demo.\n---\n\nBody.\n';
const invalidSkill = '---\nname: Bad Name\ndescription: A demo.\n---\n\nBody.\n';
const validAgent = '---\nname: reviewer\ndescription: Reviews.\n---\n\nYou review.\n';

describe('sync', () => {
  it('writes every kind and reports each action', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    await addAgent(fixture, 'reviewer', validAgent);
    await writeFile(
      join(fixture.root, 'mcp-servers.yaml'),
      'servers:\n  neon:\n    url: https://n\n',
    );
    await writeFile(join(fixture.root, 'instructions.md'), 'Be helpful.\n');
    await writeFile(
      join(fixture.root, 'hooks.yaml'),
      'hooks:\n  PreToolUse:\n    - matcher: Bash\n      command: ./check.sh\n',
    );
    await writeFile(
      join(fixture.root, 'defaults.yaml'),
      'claude:\n  model: opus\ncodex:\n  model: gpt-5.6\n',
    );

    expect(await runCli(['sync'], fixture.dependencies)).toBe(0);

    expect(
      await readFile(join(fixture.home, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'),
    ).toContain('A demo.');
    expect(
      await readFile(join(fixture.home, '.codex', 'agents', 'reviewer.toml'), 'utf8'),
    ).toContain('developer_instructions');
    expect(await readFile(join(fixture.home, '.claude', 'CLAUDE.md'), 'utf8')).toContain(
      'Be helpful.',
    );
    expect(await readFile(join(fixture.home, '.codex', 'AGENTS.md'), 'utf8')).toContain(
      GENERATED_MARKER,
    );

    const claudeConfig = JSON.parse(await readFile(join(fixture.home, '.claude.json'), 'utf8'));
    expect(claudeConfig.mcpServers.neon.url).toBe('https://n');

    const settings = JSON.parse(
      await readFile(join(fixture.home, '.claude', 'settings.json'), 'utf8'),
    );
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('./check.sh');
    expect(settings.model).toBe('opus');

    const codexHooks = JSON.parse(
      await readFile(join(fixture.home, '.codex', 'hooks.json'), 'utf8'),
    );
    expect(codexHooks.hooks.PreToolUse[0].matcher).toBe('Bash');

    const codexConfig = await readFile(join(fixture.home, '.codex', 'config.toml'), 'utf8');
    expect(codexConfig).toContain('model = "gpt-5.6"');
    expect(codexConfig).toContain('[mcp_servers.neon]');

    const ledger = JSON.parse(
      await readFile(join(fixture.home, '.config', 'skillset', 'state.json'), 'utf8'),
    );
    expect(ledger.version).toBe(2);
    expect(Object.keys(ledger.items).length).toBeGreaterThan(5);

    const output = fixture.lines.join('\n');
    expect(output).toContain('claude skill demo');
    expect(output).toContain('mcp-server neon');
    expect(output).toContain('hook PreToolUse/Bash/0');
    expect(output).toContain('default model');
    expect(output).toContain('instructions');
    expect(output).toContain('re-trust the hooks via /hooks');
  });

  it('supports --json sync output, including embedded actions, and writes nothing on --dry-run', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    await writeFile(
      join(fixture.root, 'mcp-servers.yaml'),
      'servers:\n  neon:\n    url: https://n\n',
    );

    expect(await runCli(['sync', '--dry-run', '--json'], fixture.dependencies)).toBe(0);
    const parsed = JSON.parse(fixture.lines.join('\n'));
    expect(parsed.dryRun).toBe(true);
    expect(parsed.scope).toBe('user');
    expect(parsed.actions).toContainEqual(
      expect.objectContaining({ kind: 'skill', name: 'demo', action: 'write' }),
    );
    expect(parsed.actions).toContainEqual(
      expect.objectContaining({ kind: 'mcp-server', name: 'neon', action: 'write' }),
    );
    expect(await exists(join(fixture.home, '.claude', 'skills'))).toBe(false);
  });

  it('aborts when doctor finds errors', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', invalidSkill);

    expect(await runCli(['sync'], fixture.dependencies)).toBe(1);
    expect(fixture.lines.join('\n')).toContain('sync aborted');
  });

  it('honors --scope project', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    await writeFile(join(fixture.root, 'instructions.md'), 'Project rules.\n');

    expect(await runCli(['sync', '--scope', 'project'], fixture.dependencies)).toBe(0);
    expect(
      await readFile(join(fixture.root, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'),
    ).toContain('A demo.');
    expect(await readFile(join(fixture.root, 'CLAUDE.md'), 'utf8')).toContain('Project rules.');
    expect(await readFile(join(fixture.root, 'AGENTS.md'), 'utf8')).toContain('Project rules.');
    expect(await exists(join(fixture.home, '.claude', 'skills'))).toBe(false);
  });

  it('skips drifted managed targets and honors --force', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);

    expect(await runCli(['sync'], fixture.dependencies)).toBe(0);

    const compiled = join(fixture.home, '.claude', 'skills', 'demo', 'SKILL.md');
    await writeFile(compiled, `${await readFile(compiled, 'utf8')}\nhand edit\n`);

    fixture.lines.length = 0;
    expect(await runCli(['sync', '--target', 'claude'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.join('\n')).toContain('hand-edited since last sync');
    expect(await readFile(compiled, 'utf8')).toContain('hand edit');

    expect(await runCli(['sync', '--target', 'claude', '--force'], fixture.dependencies)).toBe(0);
    expect(await readFile(compiled, 'utf8')).not.toContain('hand edit');
  });

  it('scopes to --kind', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    await writeFile(join(fixture.root, 'instructions.md'), 'Be helpful.\n');

    expect(await runCli(['sync', '--kind', 'instructions'], fixture.dependencies)).toBe(0);
    expect(await exists(join(fixture.home, '.claude', 'CLAUDE.md'))).toBe(true);
    expect(await exists(join(fixture.home, '.claude', 'skills'))).toBe(false);
  });
});

describe('doctor --targets', () => {
  it('reports clean, drifted, and missing managed outputs', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    await addAgent(fixture, 'reviewer', validAgent);
    await writeFile(join(fixture.root, 'defaults.yaml'), 'claude:\n  model: opus\n');
    expect(await runCli(['sync'], fixture.dependencies)).toBe(0);

    fixture.lines.length = 0;
    expect(await runCli(['doctor', '--targets'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.join('\n')).toContain('clean claude skill demo');

    const compiled = join(fixture.home, '.claude', 'skills', 'demo', 'SKILL.md');
    await writeFile(compiled, 'tampered');
    await rm(join(fixture.home, '.codex', 'agents', 'reviewer.toml'));
    const settingsPath = join(fixture.home, '.claude', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    settings.model = 'haiku';
    await writeFile(settingsPath, JSON.stringify(settings));

    fixture.lines.length = 0;
    expect(await runCli(['doctor', '--targets', '--json'], fixture.dependencies)).toBe(1);
    const rows = JSON.parse(fixture.lines.join('\n'));
    const status = (kind: string, name: string): string =>
      rows.find((row: { kind: string; name: string }) => row.kind === kind && row.name === name)
        .status;
    expect(status('skill', 'demo')).toBe('drift');
    expect(status('default', 'model')).toBe('drift');
    expect(rows.filter((row: { status: string }) => row.status === 'missing').length).toBe(1);
  });

  it('reports an empty ledger gracefully', async () => {
    const fixture = await makeFixture();
    expect(await runCli(['doctor', '--targets'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.join('\n')).toContain('nothing managed yet');
  });
});

describe('import', () => {
  it('imports and adopts a hand-installed claude skill', async () => {
    const fixture = await makeFixture();
    const installed = join(fixture.home, '.claude', 'skills', 'legacy');
    await mkdir(join(installed, 'references'), { recursive: true });
    await writeFile(
      join(installed, 'SKILL.md'),
      '---\nname: legacy\ndescription: Hand installed.\n---\n\nOld body.\n',
    );
    await writeFile(join(installed, 'references', 'notes.md'), 'notes');

    expect(await runCli(['import', 'skill', 'legacy'], fixture.dependencies)).toBe(0);

    const source = await readFile(join(fixture.root, 'skills', 'legacy', 'SKILL.md'), 'utf8');
    expect(source).toContain('Hand installed.');
    expect(source).not.toContain(GENERATED_MARKER);
    expect(await exists(join(fixture.root, 'skills', 'legacy', 'references', 'notes.md'))).toBe(
      true,
    );

    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain(GENERATED_MARKER);
    expect(fixture.lines.join('\n')).toContain('adopted');
  });

  it('imports a codex agent, reverse-compiling the TOML', async () => {
    const fixture = await makeFixture();
    const agents = join(fixture.home, '.codex', 'agents');
    await mkdir(agents, { recursive: true });
    await writeFile(
      join(agents, 'helper.toml'),
      'name = "helper"\ndescription = "Helps."\nmodel = "gpt-5.6-luna"\ndeveloper_instructions = """\nYou help.\n"""\n',
    );

    expect(
      await runCli(['import', 'agent', 'helper', '--from', 'codex'], fixture.dependencies),
    ).toBe(0);

    const source = await readFile(join(fixture.root, 'agents', 'helper.md'), 'utf8');
    expect(source).toContain('name: helper');
    expect(source).toContain('model: gpt-5.6-luna');
    expect(source).toContain('You help.');
  });

  it('imports instructions and refuses duplicates', async () => {
    const fixture = await makeFixture();
    await mkdir(join(fixture.home, '.claude'), { recursive: true });
    await writeFile(join(fixture.home, '.claude', 'CLAUDE.md'), 'My global rules.\n');

    expect(await runCli(['import', 'instructions'], fixture.dependencies)).toBe(0);
    expect(await readFile(join(fixture.root, 'instructions.md'), 'utf8')).toContain(
      'My global rules.',
    );

    fixture.lines.length = 0;
    expect(await runCli(['import', 'instructions'], fixture.dependencies)).toBe(1);
    expect(fixture.lines.join('\n')).toContain('already exists');
  });

  it('surfaces doctor errors instead of adopting', async () => {
    const fixture = await makeFixture();
    const installed = join(fixture.home, '.claude', 'skills', 'Bad');
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, 'SKILL.md'), '---\nname: Bad\ndescription: x\n---\nbody');

    expect(await runCli(['import', 'skill', 'Bad'], fixture.dependencies)).toBe(1);
    expect(fixture.lines.join('\n')).toContain('doctor errors');
  });
});
