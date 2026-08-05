import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeHooksApply, planHooksApply, type HookConfigFiles } from './hooks-apply.js';
import { hookEntry, parseHooksSource } from './hooks-config.js';
import { embeddedKey, type Ledger } from './ledger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeFiles(): Promise<HookConfigFiles> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-hooks-'));
  temporaryDirectories.push(base);

  return { claude: join(base, 'settings.json'), codex: join(base, 'hooks.json') };
}

function freshLedger(): Ledger {
  return { version: 2, items: {} };
}

const source = parseHooksSource(
  'hooks:\n  PreToolUse:\n    - matcher: Bash\n      command: ./check.sh\n  FileChanged:\n    - command: ./watch.sh\n      targets: [claude]\n',
);

const options = {
  targets: ['claude', 'codex'] as ('claude' | 'codex')[],
  scope: 'user' as const,
  prune: false,
  force: false,
};

describe('planHooksApply', () => {
  it('plans writes, restricting codex to its supported events', async () => {
    const files = await makeFiles();
    const actions = await planHooksApply(source, files, freshLedger(), options);
    expect(actions.map((action) => `${action.target}:${action.name}:${action.action}`)).toEqual([
      'claude:PreToolUse/Bash/0:write',
      'claude:FileChanged/*/0:write',
      'codex:PreToolUse/Bash/0:write',
    ]);
  });

  it('flags hand-edited managed entries as drifted', async () => {
    const files = await makeFiles();
    const ledger = freshLedger();
    await executeHooksApply(
      source,
      await planHooksApply(source, files, ledger, options),
      files,
      ledger,
      'user',
      new Set(),
    );

    const clean = await planHooksApply(source, files, ledger, { ...options, targets: ['claude'] });
    expect(clean.map((action) => action.action)).toEqual(['overwrite', 'overwrite']);

    const settings = JSON.parse(await readFile(files.claude, 'utf8'));
    settings.hooks.PreToolUse[0].hooks[0].command = './edited.sh';
    await writeFile(files.claude, JSON.stringify(settings));

    const drifted = await planHooksApply(source, files, ledger, {
      ...options,
      targets: ['claude'],
    });
    expect(drifted.find((action) => action.name === 'PreToolUse/Bash/0')?.action).toBe(
      'skip-drifted',
    );

    const forced = await planHooksApply(source, files, ledger, {
      ...options,
      targets: ['claude'],
      force: true,
    });
    expect(forced.every((action) => action.action === 'overwrite')).toBe(true);
  });

  it('plans prunes for ledger hooks that left the source', async () => {
    const files = await makeFiles();
    const ledger = freshLedger();
    ledger.items[embeddedKey(files.claude, 'hook', 'Stop/*/0')] = {
      kind: 'hook',
      name: 'Stop/*/0',
      scope: 'user',
      target: 'claude',
      hash: '',
      syncedAt: '',
      entry: { hooks: [{ type: 'command', command: './old.sh' }] },
    };

    const actions = await planHooksApply(source, files, ledger, {
      ...options,
      targets: ['claude'],
      prune: true,
    });
    expect(actions.find((action) => action.name === 'Stop/*/0')?.action).toBe('prune');
  });
});

describe('executeHooksApply', () => {
  it('inserts entries into both configs, preserving hand-written hooks', async () => {
    const files = await makeFiles();
    await writeFile(
      files.claude,
      JSON.stringify({
        permissions: { allow: ['Read'] },
        hooks: {
          PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'mine.sh' }] }],
        },
      }),
    );

    const ledger = freshLedger();
    await executeHooksApply(
      source,
      await planHooksApply(source, files, ledger, options),
      files,
      ledger,
      'user',
      new Set(),
    );

    const settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.permissions).toEqual({ allow: ['Read'] });
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.FileChanged).toHaveLength(1);

    const codex = JSON.parse(await readFile(files.codex, 'utf8'));
    expect(codex.hooks.PreToolUse).toHaveLength(1);
    expect(codex.hooks.FileChanged).toBeUndefined();

    const item = ledger.items[embeddedKey(files.codex, 'hook', 'PreToolUse/Bash/0')];
    expect(item?.entry).toEqual(hookEntry(source.hooks['PreToolUse']![0]!, 'codex'));
  });

  it('leaves sibling entries for the same event alone when only one changes', async () => {
    const files = await makeFiles();
    const twoOnSameEvent = parseHooksSource(
      'hooks:\n  PreToolUse:\n    - matcher: Bash\n      command: ./a.sh\n    - matcher: Write\n      command: ./b.sh\n',
    );
    const ledger = freshLedger();
    await executeHooksApply(
      twoOnSameEvent,
      await planHooksApply(twoOnSameEvent, files, ledger, { ...options, targets: ['claude'] }),
      files,
      ledger,
      'user',
      new Set(),
    );

    let settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(2);

    const updated = parseHooksSource(
      'hooks:\n  PreToolUse:\n    - matcher: Bash\n      command: ./a-v2.sh\n    - matcher: Write\n      command: ./b.sh\n',
    );
    await executeHooksApply(
      updated,
      await planHooksApply(updated, files, ledger, { ...options, targets: ['claude'] }),
      files,
      ledger,
      'user',
      new Set(),
    );

    settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    const commands = settings.hooks.PreToolUse.map(
      (entry: { hooks: { command: string }[] }) => entry.hooks[0]?.command,
    );
    expect(commands).toEqual(['./a-v2.sh', './b.sh']);
  });

  it('replaces managed entries without duplicating and prunes cleanly', async () => {
    const files = await makeFiles();
    const ledger = freshLedger();
    const apply = async (input: typeof source | undefined, prune = false): Promise<void> =>
      executeHooksApply(
        input,
        await planHooksApply(input, files, ledger, { ...options, targets: ['claude'], prune }),
        files,
        ledger,
        'user',
        new Set(),
      );

    await apply(source);
    await apply(source);
    let settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);

    const updated = parseHooksSource(
      'hooks:\n  PreToolUse:\n    - matcher: Bash\n      command: ./check-v2.sh\n',
    );
    await apply(updated);
    settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('./check-v2.sh');

    await apply(undefined, true);
    settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.hooks).toEqual({});
    expect(Object.keys(ledger.items)).toEqual([]);
  });
});
