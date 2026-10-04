import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readJsonConfig } from './config-files.js';

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
