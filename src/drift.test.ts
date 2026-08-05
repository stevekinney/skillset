import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { itemStatus } from './drift.js';
import { embeddedKey, hashContent, type LedgerItem } from './ledger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillset-drift-'));
  temporaryDirectories.push(root);

  return root;
}

function fileItem(overrides: Partial<LedgerItem> = {}): LedgerItem {
  return {
    kind: 'skill',
    name: 'demo',
    scope: 'user',
    target: 'claude',
    hash: '',
    syncedAt: '',
    ...overrides,
  };
}

describe('itemStatus — file kinds', () => {
  it('is clean when every recorded file hash matches disk', async () => {
    const root = await makeRoot();
    const skillDirectory = join(root, 'demo');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(skillDirectory, 'SKILL.md'), 'contents');

    const item = fileItem({ entry: { files: { 'SKILL.md': hashContent('contents') } } });
    expect(await itemStatus(skillDirectory, item)).toBe('clean');
  });

  it('is drift when a recorded file changed', async () => {
    const root = await makeRoot();
    const skillDirectory = join(root, 'demo');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(skillDirectory, 'SKILL.md'), 'edited');

    const item = fileItem({ entry: { files: { 'SKILL.md': hashContent('original') } } });
    expect(await itemStatus(skillDirectory, item)).toBe('drift');
  });

  it('is missing when a recorded file is gone', async () => {
    const root = await makeRoot();
    const item = fileItem({ entry: { files: { 'SKILL.md': hashContent('x') } } });
    expect(await itemStatus(join(root, 'gone'), item)).toBe('missing');
  });

  it('is clean for a single-file item with the root as its own path (empty relative path)', async () => {
    const root = await makeRoot();
    const file = join(root, 'instructions.md');
    await writeFile(file, 'Be helpful.');

    const item = fileItem({
      kind: 'instructions',
      entry: { files: { '': hashContent('Be helpful.') } },
    });
    expect(await itemStatus(file, item)).toBe('clean');
  });

  it('is clean when nothing was recorded (pre-ledger output)', async () => {
    const root = await makeRoot();
    expect(await itemStatus(join(root, 'anything'), fileItem({ entry: undefined }))).toBe('clean');
  });
});

describe('itemStatus — embedded kinds', () => {
  it('reports missing when the config file is absent or unparseable', async () => {
    const root = await makeRoot();
    const key = embeddedKey(join(root, 'missing.json'), 'mcp-server', 'neon');
    expect(await itemStatus(key, fileItem({ kind: 'mcp-server', name: 'neon' }))).toBe('missing');

    const brokenJson = join(root, 'broken.json');
    await writeFile(brokenJson, 'not json');
    expect(
      await itemStatus(
        embeddedKey(brokenJson, 'mcp-server', 'neon'),
        fileItem({ kind: 'mcp-server', name: 'neon' }),
      ),
    ).toBe('missing');

    const brokenToml = join(root, 'broken.toml');
    await writeFile(brokenToml, '[broken');
    expect(
      await itemStatus(
        embeddedKey(brokenToml, 'mcp-server', 'neon'),
        fileItem({ kind: 'mcp-server', name: 'neon' }),
      ),
    ).toBe('missing');
  });

  it('checks mcp-server entries in both claude JSON and codex TOML shapes', async () => {
    const root = await makeRoot();
    const entry = { type: 'http', url: 'https://n' };

    const claudeConfig = join(root, 'claude.json');
    await writeFile(claudeConfig, JSON.stringify({ mcpServers: { neon: entry } }));
    const claudeItem = fileItem({ kind: 'mcp-server', name: 'neon', entry });
    expect(await itemStatus(embeddedKey(claudeConfig, 'mcp-server', 'neon'), claudeItem)).toBe(
      'clean',
    );

    const codexConfig = join(root, 'config.toml');
    await writeFile(codexConfig, '[mcp_servers.neon]\nurl = "https://n"\n');
    const codexItem = fileItem({ kind: 'mcp-server', name: 'neon', entry: { url: 'https://n' } });
    expect(await itemStatus(embeddedKey(codexConfig, 'mcp-server', 'neon'), codexItem)).toBe(
      'clean',
    );

    await writeFile(claudeConfig, JSON.stringify({ mcpServers: {} }));
    expect(await itemStatus(embeddedKey(claudeConfig, 'mcp-server', 'neon'), claudeItem)).toBe(
      'missing',
    );

    await writeFile(
      claudeConfig,
      JSON.stringify({ mcpServers: { neon: { type: 'http', url: 'https://edited' } } }),
    );
    expect(await itemStatus(embeddedKey(claudeConfig, 'mcp-server', 'neon'), claudeItem)).toBe(
      'drift',
    );
  });

  it('checks hook entries by event and structural equality', async () => {
    const root = await makeRoot();
    const entry = { hooks: [{ type: 'command', command: './check.sh' }] };
    const config = join(root, 'settings.json');
    await writeFile(config, JSON.stringify({ hooks: { PreToolUse: [entry] } }));

    const item = fileItem({ kind: 'hook', name: 'PreToolUse/Bash/0', entry });
    expect(await itemStatus(embeddedKey(config, 'hook', item.name), item)).toBe('clean');

    await writeFile(config, JSON.stringify({ hooks: {} }));
    expect(await itemStatus(embeddedKey(config, 'hook', item.name), item)).toBe('drift');
  });

  it('checks default scalars by equality', async () => {
    const root = await makeRoot();
    const config = join(root, 'settings.json');
    await writeFile(config, JSON.stringify({ model: 'opus' }));

    const item = fileItem({ kind: 'default', name: 'model', entry: 'opus' });
    expect(await itemStatus(embeddedKey(config, 'default', 'model'), item)).toBe('clean');

    await writeFile(config, JSON.stringify({ model: 'haiku' }));
    expect(await itemStatus(embeddedKey(config, 'default', 'model'), item)).toBe('drift');
  });
});
