import { describe, expect, it } from 'bun:test';

import { retryOnWindowsLock } from './file-retry.js';

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
