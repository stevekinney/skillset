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
import { readJsonConfig } from './config-files.js';
import { planDefaultsApply } from './defaults-apply.js';
import { parseDefaultsSource } from './defaults-config.js';
import { planMcpApply } from './mcp-apply.js';
import { parseMcpSource } from './mcp-config.js';
import { executeSync, planSync } from './sync.js';

afterEach(removeSyncFixtures);

/** What a promise rejects with, or `undefined` if it resolves. */
const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );

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

describe('shared config files skillset cannot read', () => {
  it('refuses to plan or apply over them instead of treating them as empty', async () => {
    // POSIX permissions only, and root reads through them anyway.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const targets = await makeTargets();
    const files = {
      claude: join(dirname(targets.ledgerFile), 'claude.json'),
      codex: join(dirname(targets.ledgerFile), 'config.toml'),
    };
    await mkdir(dirname(files.claude), { recursive: true });
    await writeFile(files.claude, '{"mcpServers": {"mine": {"command": "x"}}}');
    await writeFile(files.codex, 'model = "mine"\n');
    await chmod(files.claude, 0o000);
    await chmod(files.codex, 0o000);
    try {
      expect(await settle(readJsonConfig(files.claude))).toBeInstanceOf(Error);
      const mcp = parseMcpSource('servers:\n  a:\n    command: y\n');
      const applyOptions = {
        targets: ['claude', 'codex'] as ('claude' | 'codex')[],
        scope: 'user' as const,
        prune: false,
        force: false,
      };
      expect(await settle(planMcpApply(mcp, files, freshLedger(), applyOptions))).toBeInstanceOf(
        Error,
      );
      const defaults = parseDefaultsSource('codex:\n  model: gpt-5.6\n');
      expect(
        await settle(
          planDefaultsApply(defaults, files, freshLedger(), {
            ...applyOptions,
            targets: ['codex'],
          }),
        ),
      ).toBeInstanceOf(Error);
    } finally {
      await chmod(files.claude, 0o644);
      await chmod(files.codex, 0o644);
    }
  });
});
