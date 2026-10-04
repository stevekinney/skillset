import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
