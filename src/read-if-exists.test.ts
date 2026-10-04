import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readIfExists } from './read-if-exists.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'skillset-read-'));
  directories.push(directory);
  return directory;
}

describe('readIfExists', () => {
  it('reads a file, and reports a missing one as undefined', async () => {
    const directory = await scratch();
    await writeFile(join(directory, 'present'), 'contents');
    expect(await readIfExists(join(directory, 'present'))).toBe('contents');
    expect(await readIfExists(join(directory, 'absent'))).toBeUndefined();
    expect(await readIfExists(join(directory, 'absent', 'below-a-file'))).toBeUndefined();
  });

  it('throws for a file that exists but cannot be read, instead of calling it empty', async () => {
    const directory = await scratch();
    await mkdir(join(directory, 'a-directory'));
    const asDirectory = await readIfExists(join(directory, 'a-directory')).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(asDirectory).toBeInstanceOf(Error);

    // POSIX permissions only, and root reads through them anyway.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const locked = join(directory, 'locked');
    await writeFile(locked, 'secret');
    await chmod(locked, 0o000);
    const unreadable = await readIfExists(locked).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    await chmod(locked, 0o644);
    expect(unreadable).toBeInstanceOf(Error);
  });
});
