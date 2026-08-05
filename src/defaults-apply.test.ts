import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  executeDefaultsApply,
  planDefaultsApply,
  type DefaultsConfigFiles,
} from './defaults-apply.js';
import { parseDefaultsSource } from './defaults-config.js';
import { embeddedKey, type Ledger } from './ledger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeFiles(): Promise<DefaultsConfigFiles> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-defaults-'));
  temporaryDirectories.push(base);

  return { claude: join(base, 'settings.json'), codex: join(base, 'config.toml') };
}

function freshLedger(): Ledger {
  return { version: 2, items: {} };
}

const source = parseDefaultsSource(
  'claude:\n  model: opus\n  effort: high\ncodex:\n  model: gpt-5.6-sol\n',
);

const options = {
  targets: ['claude', 'codex'] as ('claude' | 'codex')[],
  scope: 'user' as const,
  prune: false,
  force: false,
};

describe('planDefaultsApply', () => {
  it('plans writes for absent keys and skips user-set ones', async () => {
    const files = await makeFiles();
    await writeFile(files.claude, JSON.stringify({ model: 'sonnet' }));

    const actions = await planDefaultsApply(source, files, freshLedger(), options);
    const byName = new Map(
      actions.map((action) => [`${action.target}:${action.name}`, action.action]),
    );
    expect(byName.get('claude:model')).toBe('skip-unmanaged');
    expect(byName.get('claude:effortLevel')).toBe('write');
    expect(byName.get('codex:model')).toBe('write');
  });

  it('refuses a codex config that is not valid TOML', async () => {
    const files = await makeFiles();
    await writeFile(files.codex, '[broken');

    expect(
      planDefaultsApply(source, files, freshLedger(), { ...options, targets: ['codex'] }),
    ).rejects.toThrow('not valid TOML');
  });

  it('detects drift on managed keys and honors force', async () => {
    const files = await makeFiles();
    const ledger = freshLedger();
    await executeDefaultsApply(
      source,
      await planDefaultsApply(source, files, ledger, options),
      files,
      ledger,
      'user',
      new Set(),
    );

    const settings = JSON.parse(await readFile(files.claude, 'utf8'));
    settings.model = 'haiku';
    await writeFile(files.claude, JSON.stringify(settings));

    const drifted = await planDefaultsApply(source, files, ledger, {
      ...options,
      targets: ['claude'],
    });
    expect(drifted.find((action) => action.name === 'model')?.action).toBe('skip-drifted');
    expect(drifted.find((action) => action.name === 'effortLevel')?.action).toBe('overwrite');

    const forced = await planDefaultsApply(source, files, ledger, {
      ...options,
      targets: ['claude'],
      force: true,
    });
    expect(forced.every((action) => action.action === 'overwrite')).toBe(true);
  });

  it('plans prunes for managed keys that left the source', async () => {
    const files = await makeFiles();
    const ledger = freshLedger();
    ledger.items[embeddedKey(files.codex, 'default', 'model_verbosity')] = {
      kind: 'default',
      name: 'model_verbosity',
      scope: 'user',
      target: 'codex',
      hash: '',
      syncedAt: '',
      entry: 'low',
    };

    const actions = await planDefaultsApply(source, files, ledger, {
      ...options,
      targets: ['codex'],
      prune: true,
    });
    expect(actions.map((action) => `${action.name}:${action.action}`)).toEqual([
      'model:write',
      'model_verbosity:prune',
    ]);
  });
});

describe('executeDefaultsApply', () => {
  it('writes both configs surgically and records the ledger', async () => {
    const files = await makeFiles();
    await writeFile(files.claude, JSON.stringify({ theme: 'dark' }));
    await writeFile(
      files.codex,
      '# comment\napproval_policy = "on-request"\n\n[agents]\nmax_threads = 4\n',
    );

    const ledger = freshLedger();
    await executeDefaultsApply(
      source,
      await planDefaultsApply(source, files, ledger, options),
      files,
      ledger,
      'user',
      new Set(),
    );

    const settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.theme).toBe('dark');
    expect(settings.model).toBe('opus');
    expect(settings.effortLevel).toBe('high');

    const codex = await readFile(files.codex, 'utf8');
    expect(codex).toContain('# comment');
    expect(codex).toContain('approval_policy = "on-request"');
    expect(codex).toContain('model = "gpt-5.6-sol"');
    expect(codex.indexOf('model = ')).toBeLessThan(codex.indexOf('[agents]'));

    expect(ledger.items[embeddedKey(files.claude, 'default', 'model')]?.entry).toBe('opus');
  });

  it('prunes only values that still match the ledger and forgets items', async () => {
    const files = await makeFiles();
    const ledger = freshLedger();
    await executeDefaultsApply(
      source,
      await planDefaultsApply(source, files, ledger, options),
      files,
      ledger,
      'user',
      new Set(),
    );

    const emptied = parseDefaultsSource('codex:\n  model: gpt-5.6-sol\n');
    const actions = await planDefaultsApply(emptied, files, ledger, { ...options, prune: true });
    await executeDefaultsApply(emptied, actions, files, ledger, 'user', new Set());

    const settings = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(settings.model).toBeUndefined();
    expect(settings.effortLevel).toBeUndefined();
    expect(ledger.items[embeddedKey(files.claude, 'default', 'model')]).toBeUndefined();
    expect(ledger.items[embeddedKey(files.codex, 'default', 'model')]?.entry).toBe('gpt-5.6-sol');
  });
});
