import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { retryOnWindowsLock, writeUnlessChanged } from './file-retry.js';

function lockError(code: string): Error {
  return Object.assign(new Error(`${code}: locked`), { code });
}

/** An operation that fails with `codes`, in order, then succeeds. */
function failingThen(codes: string[]) {
  let attempt = 0;
  return {
    operation: async () => {
      const code = codes[attempt];
      attempt += 1;
      if (code !== undefined) throw lockError(code);
      return 'done';
    },
    attempts: () => attempt,
  };
}

describe('retryOnWindowsLock', () => {
  it('retries a transient Windows lock with growing waits, then succeeds', async () => {
    const waits: number[] = [];
    const { operation, attempts } = failingThen(['EBUSY', 'EPERM', 'EACCES']);
    const result = await retryOnWindowsLock(operation, {
      platform: 'win32',
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    expect(result).toBe('done');
    expect(attempts()).toBe(4);
    expect(waits).toEqual([50, 100, 200]);
  });

  it('gives up with the last error once the waits run out', async () => {
    const { operation, attempts } = failingThen(Array.from({ length: 10 }, () => 'EBUSY'));
    const failure = await retryOnWindowsLock(operation, {
      platform: 'win32',
      wait: async () => {},
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(String(failure)).toContain('EBUSY');
    expect(attempts()).toBe(6);
  });

  it('fails at once on other platforms, where these are real permission errors', async () => {
    const { operation, attempts } = failingThen(['EPERM']);
    const failure = await retryOnWindowsLock(operation, {
      platform: 'linux',
      wait: async () => {},
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(String(failure)).toContain('EPERM');
    expect(attempts()).toBe(1);
  });

  it('fails at once on Windows for an error that is not a lock', async () => {
    const { operation, attempts } = failingThen(['ENOENT']);
    const failure = await retryOnWindowsLock(operation, {
      platform: 'win32',
      wait: async () => {},
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(String(failure)).toContain('ENOENT');
    expect(attempts()).toBe(1);
  });

  it('waits for real by default', async () => {
    const { operation } = failingThen(['EBUSY']);
    const started = performance.now();
    expect(await retryOnWindowsLock(operation, { platform: 'win32' })).toBe('done');
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);
  });
});

/** A write that is locked on its first attempt and succeeds after. */
const lockedOnce = () => {
  let calls = 0;
  return async (path: string, contents: string) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('EBUSY: locked'), { code: 'EBUSY' });
    await writeFile(path, contents, 'utf8');
  };
};

describe('writeUnlessChanged', () => {
  it('retries a locked write when nothing changed the file meanwhile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillset-retry-'));
    const path = join(directory, 'settings.json');
    await writeFile(path, 'original');
    await writeUnlessChanged(path, 'ours', {
      platform: 'win32',
      wait: async () => {},
      write: lockedOnce(),
    });
    expect(await readFile(path, 'utf8')).toBe('ours');
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses to overwrite changes another program saved while it held the lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillset-retry-'));
    const path = join(directory, 'settings.json');
    await writeFile(path, 'original');
    const failure = await writeUnlessChanged(path, 'ours', {
      platform: 'win32',
      // The other program saves its own change while skillset waits.
      wait: async () => {
        await writeFile(path, 'theirs');
      },
      write: lockedOnce(),
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(String(failure)).toContain('changed while another program held it');
    expect(await readFile(path, 'utf8')).toBe('theirs');
    await rm(directory, { recursive: true, force: true });
  });

  it('writes a file that did not exist yet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillset-retry-'));
    const path = join(directory, 'new.json');
    await writeUnlessChanged(path, 'fresh');
    expect(await readFile(path, 'utf8')).toBe('fresh');
    await rm(directory, { recursive: true, force: true });
  });
});
