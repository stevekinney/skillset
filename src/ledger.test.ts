import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

describe('ledger file permissions', () => {
  // POSIX permission bits only; Windows has no owner/group/other modes.
  const posix = process.platform !== 'win32';

  it('is readable only by its owner, because it holds MCP env values and headers', async () => {
    const path = await makePath();
    await writeLedger(path, { version: 2, items: {} });
    const created = await stat(path);
    if (posix) expect(created.mode & 0o777).toBe(0o600);

    await writeFile(path, '{}', { mode: 0o644 });
    await chmod(path, 0o644);
    await writeLedger(path, { version: 2, items: {} });
    const rewritten = await stat(path);
    if (posix) expect(rewritten.mode & 0o777).toBe(0o600);
    // Replaced, not rewritten in place: the readable inode never holds the new
    // secrets, and an already-open descriptor can't see them.
    const before = await stat(path);
    await writeLedger(path, { version: 2, items: {} });
    const after = await stat(path);
    if (posix) expect(after.ino).not.toBe(before.ino);
    const leftovers = await readdir(dirname(path));
    expect(leftovers).toEqual(['state.json']);
  });
});

describe('a failed ledger write', () => {
  it('surfaces the error and leaves no temporary file behind', async () => {
    const path = await makePath();
    // A non-empty directory where the ledger belongs makes the final rename fail.
    await mkdir(join(path, 'occupied'), { recursive: true });

    const failure = await writeLedger(path, { version: 2, items: {} }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    const entries = await readdir(dirname(path));
    expect(entries).toEqual(['state.json']);
  });
});

describe('overlapping ledger writes', () => {
  it('each use their own temporary file, so neither fails and nothing is left behind', async () => {
    const path = await makePath();
    const item = {
      kind: 'skill' as const,
      name: 'demo',
      scope: 'user' as const,
      target: 'claude' as const,
      hash: 'sha256:x',
      syncedAt: 't',
    };
    const first = { version: 2 as const, items: {} };
    const second = { version: 2 as const, items: { demo: item } };
    await Promise.all([writeLedger(path, first), writeLedger(path, second)]);

    const entries = await readdir(dirname(path));
    expect(entries).toEqual(['state.json']);
    // Serialized, so the later write wins.
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(second);
  });
});

describe('a failed write in a queue of writes', () => {
  it('does not block the write queued behind it', async () => {
    const path = await makePath();
    // JSON.stringify throws on a BigInt, so the first write fails.
    const unserializable = { version: 2 as const, items: {}, broken: 1n };
    const valid = { version: 2 as const, items: {} };
    const [first, second] = await Promise.allSettled([
      writeLedger(path, unserializable),
      writeLedger(path, valid),
    ]);

    expect(first.status).toBe('rejected');
    expect(second.status).toBe('fulfilled');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(valid);
  });
});
