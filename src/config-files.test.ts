import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { backupOnce, readJsonConfig } from './config-files.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('readJsonConfig', () => {
  it('reads a file saved with a byte-order mark, as Windows editors often do', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillset-config-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'settings.json');
    await writeFile(path, '﻿{"model": "sonnet"}\n');

    expect(await readJsonConfig(path)).toEqual({ model: 'sonnet' });
  });
});

describe('backupOnce', () => {
  it('skips a file that does not exist yet, but stops when the backup itself fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillset-backup-'));
    temporaryDirectories.push(directory);
    await backupOnce(join(directory, 'absent.json'), new Set());

    const path = join(directory, 'settings.json');
    await writeFile(path, '{}');
    // A directory where the backup belongs makes the copy fail for a real reason.
    await mkdir(`${path}.skillset-backup`);
    const failure = await backupOnce(path, new Set()).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
  });

  // A lock on a shared config may mean someone is editing it; waiting it out and
  // then applying the plan made before their edit would overwrite their change.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails at once on a Windows lock instead of retrying',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'skillset-backup-'));
      temporaryDirectories.push(directory);
      const path = join(directory, 'settings.json');
      await writeFile(path, '{}');
      await chmod(directory, 0o500);
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        const started = performance.now();
        const failure = await backupOnce(path, new Set()).then(
          () => undefined,
          (cause: unknown) => cause,
        );
        expect(failure).toMatchObject({ code: 'EACCES' });
        expect(performance.now() - started).toBeLessThan(40);
      } finally {
        Object.defineProperty(process, 'platform', platform);
        await chmod(directory, 0o700);
      }
    },
  );
});
