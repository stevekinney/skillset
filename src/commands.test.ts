import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getField,
  listEntries,
  newSource,
  removeSource,
  renderValue,
  setField,
  showSource,
} from './commands.js';
import { discoverSources } from './discover.js';

const temporaryDirectories: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillset-commands-'));
  temporaryDirectories.push(root);

  await mkdir(join(root, 'skills', 'demo'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: A demo.\nopenai:\n  interface:\n    display_name: Demo\n---\n\nBody.\n',
  );
  await mkdir(join(root, 'agents'), { recursive: true });
  await writeFile(
    join(root, 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews.\n---\n\nYou review.\n',
  );
  await writeFile(join(root, 'mcp-servers.yaml'), 'servers:\n  neon:\n    url: https://n\n');

  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('listEntries', () => {
  it('lists every kind with doctor status', async () => {
    const root = await makeRoot();
    const entries = listEntries(await discoverSources(root));
    expect(entries).toEqual([
      { kind: 'skill', name: 'demo', status: 'ok' },
      { kind: 'agent', name: 'reviewer', status: 'ok' },
      { kind: 'mcp-server', name: 'neon', status: 'ok' },
    ]);
  });

  it('reports error statuses, including a broken mcp file', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), 'no frontmatter');
    await writeFile(join(root, 'mcp-servers.yaml'), '- broken\n');

    const entries = listEntries(await discoverSources(root));
    expect(entries.map((entry) => entry.status)).toEqual(['errors', 'ok', 'errors']);
  });
});

describe('showSource', () => {
  it('compiles a skill for both targets', async () => {
    const files = showSource(await discoverSources(await makeRoot()), 'demo', ['claude', 'codex']);
    expect(files.map((file) => file.label)).toEqual([
      'demo/SKILL.md',
      'demo/SKILL.md',
      'demo/agents/openai.yaml',
    ]);
  });

  it('compiles an agent and an mcp server', async () => {
    const sources = await discoverSources(await makeRoot());

    const agent = showSource(sources, 'reviewer', ['codex']);
    expect(agent[0]?.label).toBe('reviewer.toml');
    expect(agent[0]?.contents).toContain('developer_instructions');

    const server = showSource(sources, 'neon', ['claude', 'codex']);
    expect(server[0]?.contents).toContain('"type": "http"');
    expect(server[1]?.contents).toContain('[mcp_servers.neon]');
  });

  it('throws for unknown names and for broken sources', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'agents', 'broken.md'), 'no frontmatter');
    const sources = await discoverSources(root);

    expect(() => showSource(sources, 'missing', ['claude'])).toThrow('no skill, agent');
    expect(() => showSource(sources, 'broken', ['claude'])).toThrow('has errors');
  });

  it('throws for a skill with errors', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), 'no frontmatter');

    const sources = await discoverSources(root);
    expect(() => showSource(sources, 'demo', ['claude'])).toThrow('has errors');
  });
});

describe('newSource and removeSource', () => {
  it('scaffolds doctor-clean sources and refuses duplicates', async () => {
    const root = await makeRoot();

    const skillPath = await newSource(root, 'skill', 'fresh-skill');
    expect(await readFile(skillPath, 'utf8')).toContain('name: fresh-skill');
    const agentPath = await newSource(root, 'agent', 'fresh-agent');
    expect(await readFile(agentPath, 'utf8')).toContain('name: fresh-agent');

    expect(newSource(root, 'skill', 'fresh-skill')).rejects.toThrow('already exists');
    expect(newSource(root, 'skill', 'Bad Name')).rejects.toThrow('not a valid');
  });

  it('removes a skill directory or an agent file', async () => {
    const root = await makeRoot();

    const removedSkill = await removeSource(root, 'skill', 'demo');
    expect(removedSkill).toBe(join(root, 'skills', 'demo'));
    expect((await stat(removedSkill).catch(() => undefined)) === undefined).toBe(true);

    await removeSource(root, 'agent', 'reviewer');
    expect(removeSource(root, 'agent', 'reviewer')).rejects.toThrow('no agent named');
  });
});

describe('getField and setField', () => {
  it('reads whole frontmatter and dot paths', async () => {
    const root = await makeRoot();
    const all = await getField(root, 'skill', 'demo');
    expect(all).toMatchObject({ name: 'demo' });

    expect(await getField(root, 'skill', 'demo', 'openai.interface.display_name')).toBe('Demo');
    expect(await getField(root, 'skill', 'demo', 'missing.path')).toBeUndefined();
    expect(getField(root, 'agent', 'missing')).rejects.toThrow('no agent named');
  });

  it('sets scalar, nested, and typed values while preserving the body', async () => {
    const root = await makeRoot();

    await setField(root, 'skill', 'demo', 'model', 'sonnet');
    await setField(root, 'skill', 'demo', 'disable-model-invocation', 'true');
    await setField(root, 'skill', 'demo', 'openai.interface.short_description', 'Short.');
    await setField(root, 'agent', 'reviewer', 'codex.model', 'gpt-5.6-luna');

    const raw = await readFile(join(root, 'skills', 'demo', 'SKILL.md'), 'utf8');
    expect(raw).toContain('model: sonnet');
    expect(raw).toContain('disable-model-invocation: true');
    expect(raw).toContain('short_description: Short.');
    expect(raw.endsWith('\nBody.\n')).toBe(true);

    expect(await getField(root, 'agent', 'reviewer', 'codex.model')).toBe('gpt-5.6-luna');
  });

  it('deletes a field with an empty value', async () => {
    const root = await makeRoot();
    await setField(root, 'skill', 'demo', 'openai', '');
    expect(await getField(root, 'skill', 'demo', 'openai')).toBeUndefined();
  });

  it('refuses writes that would break the schema', async () => {
    const root = await makeRoot();
    expect(setField(root, 'skill', 'demo', 'effort', 'extreme')).rejects.toThrow(
      'refusing to write invalid frontmatter',
    );
    expect(setField(root, 'agent', 'reviewer', 'permissionMode', 'sudo')).rejects.toThrow(
      'refusing to write invalid frontmatter',
    );
  });
});

describe('renderValue', () => {
  it('renders strings plainly, structures as YAML, and JSON on demand', () => {
    expect(renderValue('sonnet', false)).toBe('sonnet');
    expect(renderValue({ a: 1 }, false)).toBe('a: 1');
    expect(renderValue({ a: 1 }, true)).toBe('{\n  "a": 1\n}');
  });
});
