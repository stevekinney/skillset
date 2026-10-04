import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
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

/** What a promise rejects with, or `undefined` if it resolves. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );

describe('readLedger', () => {
  it('starts fresh only when there is no ledger yet', async () => {
    expect(await readLedger('/nowhere/state.json', migration)).toEqual({ version: 2, items: {} });
  });

  // An empty ledger forgets what skillset owns, and the next write would make
  // that permanent, so a ledger that can't be read stops the run instead.
  it.each([
    ['is not JSON', 'not json'],
    ['is from an unknown version', JSON.stringify({ version: 99 })],
    ['is not an object', '[]'],
    ['has malformed items', JSON.stringify({ version: 2, items: { a: 1 } })],
    // A damaged v2 ledger must not pass for the v1 shape and migrate to empty.
    ['has lost its version', JSON.stringify({ items: {} })],
    ['has an unrecognizable v1 shape', JSON.stringify({ claude: 'neon' })],
  ])('refuses a ledger that %s', async (_case, contents) => {
    const path = await makePath();
    await writeFile(path, contents);
    expect(String(await rejection(readLedger(path, migration)))).toContain(path);
  });

  it('refuses an unreadable legacy ledger too', async () => {
    const legacy = await makePath();
    await writeFile(legacy, 'not json');
    expect(String(await rejection(readLedger(`${legacy}.current`, migration, legacy)))).toContain(
      legacy,
    );
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

describe('moving the ledger to a new location', () => {
  const item = {
    kind: 'skill' as const,
    name: 'demo',
    scope: 'user' as const,
    target: 'claude' as const,
    hash: 'sha256:x',
    syncedAt: 't',
  };
  const v1Paths = { claudeMcpConfig: '/c', codexMcpConfig: '/x' };

  it('reads the old ledger until the new one exists, and prefers the new one', async () => {
    const path = await makePath();
    const legacy = join(dirname(path), 'legacy.json');
    await writeFile(legacy, JSON.stringify({ version: 2, items: { demo: item } }));

    const fromLegacy = await readLedger(path, v1Paths, legacy);
    expect(fromLegacy.items).toEqual({ demo: item });
    await writeFile(path, JSON.stringify({ version: 2, items: {} }));
    const fromCurrent = await readLedger(path, v1Paths, legacy);
    expect(fromCurrent.items).toEqual({});
  });

  it('retires the old ledger only after writing the new one', async () => {
    const path = await makePath();
    const legacy = join(dirname(path), 'legacy.json');
    await writeFile(legacy, JSON.stringify({ version: 2, items: { demo: item } }));
    const ledger = await readLedger(path, v1Paths, legacy);

    await writeLedger(path, ledger, legacy);
    const entries = await readdir(dirname(path));
    expect(entries).toEqual(['state.json']);
    expect(JSON.parse(await readFile(path, 'utf8')).items).toEqual({ demo: item });
  });
});

describe('when the old and new ledger paths are the same file', () => {
  it('keeps the ledger instead of deleting it through the other name', async () => {
    const path = await makePath();
    // The old location reaches the new file through a symlinked directory.
    const linkedDirectory = join(dirname(path), 'linked');
    await symlink(
      dirname(path),
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const legacy = join(linkedDirectory, 'state.json');

    await writeLedger(path, { version: 2, items: {} }, legacy);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 2, items: {} });
  });
});

describe('a ledger with no old location to retire', () => {
  it('writes normally when the old path does not exist', async () => {
    const path = await makePath();
    const legacy = join(dirname(path), 'never-existed.json');
    await writeLedger(path, { version: 2, items: {} }, legacy);
    const entries = await readdir(dirname(path));
    expect(entries).toEqual(['state.json']);
  });
});

describe('a first run with no ledger anywhere', () => {
  it('starts empty when neither the new nor the old ledger exists', async () => {
    const path = await makePath();
    const ledger = await readLedger(
      path,
      { claudeMcpConfig: '/c', codexMcpConfig: '/x' },
      join(dirname(path), 'old.json'),
    );
    expect(ledger).toEqual({ version: 2, items: {} });
  });
});
