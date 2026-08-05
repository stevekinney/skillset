import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CliDependencies } from './cli.js';
import { createMcpServer, createStdioTransport, runMcpServer } from './mcp-server.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type Fixture = { dependencies: CliDependencies; root: string; home: string };

async function makeFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-mcp-'));
  temporaryDirectories.push(base);

  const home = join(base, 'home');
  await mkdir(join(base, 'skills'), { recursive: true });
  await mkdir(home, { recursive: true });

  return {
    root: base,
    home,
    dependencies: { cwd: base, env: {}, homeDirectory: home, log: () => {} },
  };
}

async function addSkill(fixture: Fixture, name: string, raw: string): Promise<void> {
  await mkdir(join(fixture.root, 'skills', name), { recursive: true });
  await writeFile(join(fixture.root, 'skills', name, 'SKILL.md'), raw);
}

const validSkill = '---\nname: demo\ndescription: A demo.\n---\n\nBody.\n';

async function connectedClient(dependencies: CliDependencies): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(dependencies);
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return client;
}

function textOf(result: any): any {
  const [first] = result.content;
  if (!first || first.type !== 'text' || first.text === undefined) {
    throw new Error('expected text content');
  }

  return JSON.parse(first.text);
}

describe('createMcpServer', () => {
  it('exposes every operation as a tool', async () => {
    const fixture = await makeFixture();
    const client = await connectedClient(fixture.dependencies);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).toSorted()).toEqual(
      [
        'check_targets',
        'get_field',
        'import_source',
        'list_sources',
        'new_source',
        'remove_source',
        'run_doctor',
        'set_field',
        'show_source',
        'sync',
      ].toSorted(),
    );
  });

  it('list_sources and run_doctor report source state', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const client = await connectedClient(fixture.dependencies);

    const list = textOf(await client.callTool({ name: 'list_sources', arguments: {} }));
    expect(list).toEqual([{ kind: 'skill', name: 'demo', status: 'ok' }]);

    const doctor: { skills: { name: string }[] } = textOf(
      await client.callTool({ name: 'run_doctor', arguments: {} }),
    );
    expect(doctor.skills[0]?.name).toBe('demo');
  });

  it('new_source, get_field, set_field, and remove_source round-trip', async () => {
    const fixture = await makeFixture();
    const client = await connectedClient(fixture.dependencies);

    const created: { created: string } = textOf(
      await client.callTool({ name: 'new_source', arguments: { kind: 'agent', name: 'helper' } }),
    );
    expect(created.created).toContain('helper.md');

    await client.callTool({
      name: 'set_field',
      arguments: { kind: 'agent', name: 'helper', path: 'model', value: 'haiku' },
    });

    const got: { value: string } = textOf(
      await client.callTool({
        name: 'get_field',
        arguments: { kind: 'agent', name: 'helper', path: 'model' },
      }),
    );
    expect(got.value).toBe('haiku');

    const removed: { removed: string } = textOf(
      await client.callTool({
        name: 'remove_source',
        arguments: { kind: 'agent', name: 'helper' },
      }),
    );
    expect(removed.removed).toContain('helper.md');
  });

  it('get_field returns null instead of undefined over JSON for a missing field', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const client = await connectedClient(fixture.dependencies);

    const got: { value: unknown } = textOf(
      await client.callTool({
        name: 'get_field',
        arguments: { kind: 'skill', name: 'demo', path: 'nope.nested' },
      }),
    );
    expect(got.value).toBeNull();
  });

  it('sync compiles sources and reports the action plan', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const client = await connectedClient(fixture.dependencies);

    const result: { dryRun: boolean; actions: { kind: string; name: string }[] } = textOf(
      await client.callTool({ name: 'sync', arguments: { dry_run: true } }),
    );
    expect(result.dryRun).toBe(true);
    expect(
      result.actions.some(
        (action: { kind: string; name: string }) =>
          action.kind === 'skill' && action.name === 'demo',
      ),
    ).toBe(true);

    await client.callTool({ name: 'sync', arguments: {} });
    expect(
      await readFile(join(fixture.home, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'),
    ).toContain('A demo.');
  });

  it('sync reports an error and aborts when sources have doctor errors', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', '---\nname: Bad Name\ndescription: x\n---\nbody');
    const client = await connectedClient(fixture.dependencies);

    const result = await client.callTool({ name: 'sync', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('check_targets reports drift after a hand edit', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const client = await connectedClient(fixture.dependencies);
    await client.callTool({ name: 'sync', arguments: {} });

    const compiled = join(fixture.home, '.claude', 'skills', 'demo', 'SKILL.md');
    await writeFile(compiled, 'tampered');

    const rows: { kind: string; status: string }[] = textOf(
      await client.callTool({ name: 'check_targets', arguments: {} }),
    );
    expect(
      rows.some(
        (row: { kind: string; status: string }) => row.kind === 'skill' && row.status === 'drift',
      ),
    ).toBe(true);
  });

  it('show_source previews compiled output', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const client = await connectedClient(fixture.dependencies);

    const files: { target: string; label: string }[] = textOf(
      await client.callTool({ name: 'show_source', arguments: { name: 'demo', target: 'codex' } }),
    );
    expect(files[0]).toMatchObject({ target: 'codex', label: 'demo/SKILL.md' });
  });

  it('import_source adopts an installed skill', async () => {
    const fixture = await makeFixture();
    const installed = join(fixture.home, '.claude', 'skills', 'legacy');
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(installed, 'SKILL.md'),
      '---\nname: legacy\ndescription: Old.\n---\n\nBody.\n',
    );
    const client = await connectedClient(fixture.dependencies);

    const result: { ok: boolean } = textOf(
      await client.callTool({
        name: 'import_source',
        arguments: { kind: 'skill', name: 'legacy' },
      }),
    );
    expect(result.ok).toBe(true);
    expect(await readFile(join(fixture.root, 'skills', 'legacy', 'SKILL.md'), 'utf8')).toContain(
      'Old.',
    );
  });

  it('import_source reports failure without throwing when adoption fails', async () => {
    const fixture = await makeFixture();
    const client = await connectedClient(fixture.dependencies);

    const result = await client.callTool({
      name: 'import_source',
      arguments: { kind: 'skill', name: 'missing' },
    });
    expect(result.isError).toBe(true);
  });

  it('honors SKILLSET_DIRECTORY from the dependencies environment', async () => {
    const fixture = await makeFixture();
    const custom = join(fixture.root, 'elsewhere');
    await mkdir(join(custom, 'skills', 'demo'), { recursive: true });
    await writeFile(join(custom, 'skills', 'demo', 'SKILL.md'), validSkill);
    await rm(join(fixture.root, 'skills'), { recursive: true });
    fixture.dependencies.env['SKILLSET_DIRECTORY'] = custom;

    const client = await connectedClient(fixture.dependencies);
    const list = textOf(await client.callTool({ name: 'list_sources', arguments: {} }));
    expect(list).toEqual([{ kind: 'skill', name: 'demo', status: 'ok' }]);
  });
});

describe('createStdioTransport', () => {
  it('builds a stdio transport', () => {
    const transport = createStdioTransport();
    expect(transport).toBeDefined();
    expect(typeof transport.start).toBe('function');
  });
});

describe('runMcpServer', () => {
  it('serves until the transport closes', async () => {
    const fixture = await makeFixture();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();

    const served = runMcpServer(fixture.dependencies, serverSide);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    await clientSide.close();
    expect(await served).toBe(0);
  });
});
