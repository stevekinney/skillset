import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  embeddedKey,
  fileKey,
  forgetItem,
  hashContent,
  readLedger,
  recordItem,
  stableStringify,
  structurallyEqual,
  writeLedger,
  type Ledger,
} from './ledger.js';

const temporaryDirectories: string[] = [];

async function makePath(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-ledger-'));
  temporaryDirectories.push(base);

  return join(base, 'state.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const migration = {
  claudeMcpConfig: '/home/.claude.json',
  codexMcpConfig: '/home/.codex/config.toml',
};

describe('keys and hashing', () => {
  it('builds file and embedded keys', () => {
    expect(fileKey('/a/b')).toBe('/a/b');
    expect(embeddedKey('/c.json', 'mcp-server', 'neon')).toBe('/c.json#mcp-server:neon');
  });

  it('hashes content stably', () => {
    expect(hashContent('x')).toBe(hashContent('x'));
    expect(hashContent('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('compares structurally regardless of key order', () => {
    expect(structurallyEqual({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toBe(
      true,
    );
    expect(structurallyEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('readLedger', () => {
  it('starts fresh for missing or malformed files', async () => {
    expect(await readLedger('/nowhere/state.json', migration)).toEqual({ version: 2, items: {} });

    const path = await makePath();
    await writeFile(path, 'not json');
    expect(await readLedger(path, migration)).toEqual({ version: 2, items: {} });

    await writeFile(path, JSON.stringify({ version: 99 }));
    expect(await readLedger(path, migration)).toEqual({ version: 2, items: {} });
  });

  it('migrates the v1 mcp state shape onto the default config paths', async () => {
    const path = await makePath();
    await writeFile(path, JSON.stringify({ claude: ['neon'], codex: ['neon', 'svelte'] }));

    const ledger = await readLedger(path, migration);
    expect(Object.keys(ledger.items).toSorted()).toEqual([
      '/home/.claude.json#mcp-server:neon',
      '/home/.codex/config.toml#mcp-server:neon',
      '/home/.codex/config.toml#mcp-server:svelte',
    ]);
    expect(ledger.items['/home/.claude.json#mcp-server:neon']).toMatchObject({
      kind: 'mcp-server',
      name: 'neon',
      target: 'claude',
      hash: '',
    });
  });

  it('round-trips through writeLedger', async () => {
    const path = await makePath();
    const ledger: Ledger = { version: 2, items: {} };
    recordItem(ledger, '/a', {
      kind: 'skill',
      name: 'demo',
      scope: 'user',
      target: 'claude',
      hash: hashContent('x'),
      entry: { files: {} },
    });

    await writeLedger(path, ledger);
    expect(await readLedger(path, migration)).toEqual(ledger);
    expect(await readFile(path, 'utf8')).toContain('"version": 2');

    forgetItem(ledger, '/a');
    expect(ledger.items).toEqual({});
  });
});
