import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  freshLedger,
  makeSources,
  makeTargets,
  options,
  removeSyncFixtures,
} from '../test/sync-fixture.js';
import { executeSync, planSync } from './sync.js';

afterEach(removeSyncFixtures);

describe('symlinked supporting files', () => {
  it('copies the linked content, not the link', async () => {
    const targets = await makeTargets();
    const sources = await makeSources();
    const skill = sources.skills[0]!;
    const original = join(skill.source.directory, 'original.txt');
    await writeFile(original, 'shared data');
    await symlink(original, join(skill.source.directory, 'data.txt'));
    sources.skills[0] = { ...skill, source: { ...skill.source, supportingFiles: ['data.txt'] } };

    const ledger = freshLedger();
    const actions = await planSync(sources, targets, ledger, {
      ...options,
      targets: ['claude'],
      kinds: ['skill'],
    });
    await executeSync(sources, actions, ledger, 'user');

    const copied = join(targets.claude.skills, 'demo', 'data.txt');
    const status = await lstat(copied);
    expect(status.isSymbolicLink()).toBe(false);
    expect(await readFile(copied, 'utf8')).toBe('shared data');
  });
});

describe('an instructions file planning cannot read', () => {
  it('surfaces the error instead of planning a write over it', async () => {
    // POSIX permissions only, and root reads through them anyway.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const targets = await makeTargets();
    await mkdir(dirname(targets.claude.instructions), { recursive: true });
    await writeFile(targets.claude.instructions, 'my own instructions');
    await chmod(targets.claude.instructions, 0o000);
    try {
      const failure = await planSync(await makeSources(), targets, freshLedger(), {
        ...options,
        targets: ['claude'],
        kinds: ['instructions'],
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(Error);
    } finally {
      await chmod(targets.claude.instructions, 0o644);
    }
  });
});
