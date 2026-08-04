import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultDependencies, runCli, type CliDependencies } from './cli.js';

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

describe('argument handling', () => {
  it('prints usage on --help and on usage errors', async () => {
    const fixture = await makeFixture();
    expect(await runCli(['--help'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.join('\n')).toContain('Usage:');

    fixture.lines.length = 0;
    expect(await runCli(['deploy'], fixture.dependencies)).toBe(1);
    expect(fixture.lines.join('\n')).toContain('unknown command `deploy`');
  });
});

describe('doctor', () => {
  it('reports every source kind together', async () => {
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
      'hooks:\n  PreToolUse:\n    - matcher: Bash\n      command: ./check.sh\n      targets: [claude]\n',
    );
    await writeFile(join(fixture.root, 'defaults.yaml'), 'claude:\n  model: opus\n');

    expect(await runCli(['doctor'], fixture.dependencies)).toBe(0);
    const output = fixture.lines.join('\n');
    for (const expected of [
      'skill demo',
      'agent reviewer',
      'mcp-servers.yaml',
      'instructions.md',
      'hooks.yaml',
      'defaults.yaml',
    ]) {
      expect(output).toContain(expected);
    }
  });

  it('exits 1 on any error and supports --json', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', invalidSkill);
    await writeFile(join(fixture.root, 'hooks.yaml'), '- broken\n');

    expect(await runCli(['doctor', '--json'], fixture.dependencies)).toBe(1);
    const parsed = JSON.parse(fixture.lines.join('\n'));
    expect(parsed.skills[0].issues[0].severity).toBe('error');
    expect(parsed.files['hooks.yaml'][0].message).toContain('invalid hooks.yaml');
  });

  it('exits 1 when no sources exist and honors SKILLSET_DIRECTORY', async () => {
    const fixture = await makeFixture();
    await rm(join(fixture.root, 'skills'), { recursive: true });

    expect(await runCli(['doctor'], fixture.dependencies)).toBe(1);
    expect(fixture.lines.join('\n')).toContain('no sources found');

    const custom = join(fixture.root, 'elsewhere');
    await mkdir(join(custom, 'skills', 'demo'), { recursive: true });
    await writeFile(join(custom, 'skills', 'demo', 'SKILL.md'), validSkill);
    fixture.dependencies.env['SKILLSET_DIRECTORY'] = custom;

    expect(await runCli(['doctor'], fixture.dependencies)).toBe(0);
  });
});

describe('crud commands', () => {
  it('list and show work across kinds', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);

    expect(await runCli(['list', '--json'], fixture.dependencies)).toBe(0);
    expect(JSON.parse(fixture.lines.join('\n'))).toEqual([
      { kind: 'skill', name: 'demo', status: 'ok' },
    ]);

    fixture.lines.length = 0;
    expect(await runCli(['list'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.join('\n')).toContain('skill demo — ok');

    fixture.lines.length = 0;
    expect(await runCli(['show', 'demo', '--target', 'codex'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.join('\n')).toContain('── codex: demo/SKILL.md');

    fixture.lines.length = 0;
    expect(await runCli(['show', 'missing', '--json'], fixture.dependencies)).toBe(1);
  });

  it('new works in an empty directory, then get/set/remove round-trip', async () => {
    const fixture = await makeFixture();
    await rm(join(fixture.root, 'skills'), { recursive: true });

    expect(await runCli(['new', 'agent', 'helper'], fixture.dependencies)).toBe(0);
    expect(await runCli(['set', 'agent', 'helper', 'model', 'haiku'], fixture.dependencies)).toBe(
      0,
    );

    fixture.lines.length = 0;
    expect(await runCli(['get', 'agent', 'helper', 'model'], fixture.dependencies)).toBe(0);
    expect(fixture.lines.at(-1)).toBe('haiku');

    fixture.lines.length = 0;
    expect(await runCli(['get', 'agent', 'helper', '--json'], fixture.dependencies)).toBe(0);
    expect(JSON.parse(fixture.lines.join('\n')).model).toBe('haiku');

    expect(await runCli(['set', 'agent', 'helper', 'memory', 'cloud'], fixture.dependencies)).toBe(
      1,
    );

    expect(await runCli(['remove', 'agent', 'helper'], fixture.dependencies)).toBe(0);
    expect(await exists(join(fixture.root, 'agents', 'helper.md'))).toBe(false);
  });
});

describe('defaults', () => {
  it('defaultDependencies reads from the real process and logs to stdout', () => {
    const dependencies = defaultDependencies();
    expect(dependencies.cwd).toBe(process.cwd());
    expect(dependencies.env).toBe(process.env);
    expect(dependencies.homeDirectory).toBe(homedir());

    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      dependencies.log('hello');
      expect(write).toHaveBeenCalledWith('hello\n');
    } finally {
      write.mockRestore();
    }
  });
});

describe('color support', () => {
  async function runBin(overrides: Record<string, string>): Promise<string> {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);

    // FORCE_COLOR/NO_COLOR must be *absent* (not empty) to stay neutral —
    // supports-color treats FORCE_COLOR='' as "force on".
    const env: Record<string, string | undefined> = { ...process.env };
    delete env['FORCE_COLOR'];
    delete env['NO_COLOR'];

    const subprocess = Bun.spawn(['bun', 'run', join(import.meta.dir, 'bin.ts'), 'doctor'], {
      cwd: fixture.root,
      env: { ...env, ...overrides },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await subprocess.exited;

    return new Response(subprocess.stdout).text();
  }

  const ESCAPE = String.fromCharCode(27);

  it('emits no ANSI codes when NO_COLOR is set', async () => {
    const output = await runBin({ NO_COLOR: '1' });
    expect(output).toContain('skill demo');
    expect(output).not.toContain(`${ESCAPE}[`);
  });

  it('emits ANSI codes when FORCE_COLOR is set', async () => {
    const output = await runBin({ FORCE_COLOR: '3' });
    expect(output).toContain(`${ESCAPE}[`);
  });
});
