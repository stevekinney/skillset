import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { embeddedKey, type Ledger } from './ledger.js';
import { executeMcpApply, planMcpApply, type McpConfigFiles } from './mcp-apply.js';
import { claudeMcpEntry, codexMcpSection, parseMcpSource } from './mcp-config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeFiles(): Promise<McpConfigFiles> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-mcp-'));
  temporaryDirectories.push(base);

  return { claude: join(base, 'claude.json'), codex: join(base, 'config.toml') };
}

function freshLedger(): Ledger {
  return { version: 2, items: {} };
}

const source = parseMcpSource(
  `servers:\n  neon:\n    url: https://mcp.neon.tech/mcp\n    headers:\n      Authorization: 'Bearer \${NEON_KEY}'\n`,
);

const options = {
  targets: ['claude', 'codex'] as ('claude' | 'codex')[],
  scope: 'user' as const,
  prune: false,
  force: false,
};

function managedLedger(files: McpConfigFiles, target: 'claude' | 'codex'): Ledger {
  const server = source.source.servers['neon']!;
  const entry = target === 'claude' ? claudeMcpEntry(server) : codexMcpSection(server);
  const ledger = freshLedger();
  ledger.items[embeddedKey(files[target], 'mcp-server', 'neon')] = {
    kind: 'mcp-server',
    name: 'neon',
    scope: 'user',
    target,
    hash: '',
    syncedAt: '',
    entry,
  };

  return ledger;
}

describe('planMcpApply', () => {
  it('plans writes when nothing exists yet', async () => {
    const files = await makeFiles();
    const actions = await planMcpApply(source, files, freshLedger(), options);
    expect(actions.map((action) => `${action.target}:${action.action}`)).toEqual([
      'claude:write',
      'codex:write',
    ]);
  });

  it('skips hand-installed servers, overwrites clean managed ones, flags drifted ones', async () => {
    const files = await makeFiles();
    await writeFile(
      files.claude,
      JSON.stringify({ mcpServers: { neon: claudeMcpEntry(source.source.servers['neon']!) } }),
    );

    const unmanaged = await planMcpApply(source, files, freshLedger(), {
      ...options,
      targets: ['claude'],
    });
    expect(unmanaged[0]?.action).toBe('skip-unmanaged');

    const clean = await planMcpApply(source, files, managedLedger(files, 'claude'), {
      ...options,
      targets: ['claude'],
    });
    expect(clean[0]?.action).toBe('overwrite');

    await writeFile(
      files.claude,
      JSON.stringify({ mcpServers: { neon: { type: 'http', url: 'https://edited' } } }),
    );
    const drifted = await planMcpApply(source, files, managedLedger(files, 'claude'), {
      ...options,
      targets: ['claude'],
    });
    expect(drifted[0]?.action).toBe('skip-drifted');

    const forced = await planMcpApply(source, files, managedLedger(files, 'claude'), {
      ...options,
      targets: ['claude'],
      force: true,
    });
    expect(forced[0]?.action).toBe('overwrite');
  });

  it('detects drift in codex TOML entries and refuses invalid TOML', async () => {
    const files = await makeFiles();
    await writeFile(files.codex, '[mcp_servers.neon]\nurl = "https://edited"\n');

    const drifted = await planMcpApply(source, files, managedLedger(files, 'codex'), {
      ...options,
      targets: ['codex'],
    });
    expect(drifted[0]?.action).toBe('skip-drifted');

    await writeFile(files.codex, '[broken');
    expect(
      planMcpApply(source, files, freshLedger(), { ...options, targets: ['codex'] }),
    ).rejects.toThrow('not valid TOML');
  });

  it('plans prunes only for ledger-managed names that left the source', async () => {
    const files = await makeFiles();
    await writeFile(files.claude, JSON.stringify({ mcpServers: { stale: {}, handmade: {} } }));
    const ledger = freshLedger();
    ledger.items[embeddedKey(files.claude, 'mcp-server', 'stale')] = {
      kind: 'mcp-server',
      name: 'stale',
      scope: 'user',
      target: 'claude',
      hash: '',
      syncedAt: '',
      entry: {},
    };

    const actions = await planMcpApply(source, files, ledger, {
      ...options,
      targets: ['claude'],
      prune: true,
    });
    expect(actions.map((action) => `${action.name}:${action.action}`)).toEqual([
      'neon:write',
      'stale:prune',
    ]);
  });

  it('refuses a claude config that is not a JSON object', async () => {
    const files = await makeFiles();
    await writeFile(files.claude, '[]');

    expect(
      planMcpApply(source, files, freshLedger(), { ...options, targets: ['claude'] }),
    ).rejects.toThrow('refusing to edit');
  });
});

describe('executeMcpApply', () => {
  it('writes both configs, preserves unrelated data, backs up, and records the ledger', async () => {
    const files = await makeFiles();
    await writeFile(
      files.claude,
      JSON.stringify({
        projects: { '/x': { history: [1, 2, 3] } },
        mcpServers: { handmade: { type: 'stdio' } },
      }),
    );
    await writeFile(files.codex, '# precious comment\nmodel = "gpt-5.6"\n');

    const ledger = freshLedger();
    const actions = await planMcpApply(source, files, ledger, options);
    await executeMcpApply(source, actions, files, ledger, 'user', new Set());

    const claude = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(claude.projects).toEqual({ '/x': { history: [1, 2, 3] } });
    expect(claude.mcpServers.handmade).toEqual({ type: 'stdio' });
    expect(claude.mcpServers.neon.url).toBe('https://mcp.neon.tech/mcp');

    const codex = await readFile(files.codex, 'utf8');
    expect(codex).toContain('# precious comment');
    expect(codex).toContain('bearer_token_env_var = "NEON_KEY"');

    expect(await readFile(`${files.claude}.skillset-backup`, 'utf8')).toContain('handmade');

    const item = ledger.items[embeddedKey(files.claude, 'mcp-server', 'neon')];
    expect(item?.kind).toBe('mcp-server');
    expect(item?.entry).toEqual(claudeMcpEntry(source.source.servers['neon']!));
    expect(item?.syncedAt).not.toBe('');
  });

  it('prunes managed entries and forgets ledger items', async () => {
    const files = await makeFiles();
    await writeFile(files.claude, JSON.stringify({ mcpServers: { stale: {} } }));
    const ledger = freshLedger();
    ledger.items[embeddedKey(files.claude, 'mcp-server', 'stale')] = {
      kind: 'mcp-server',
      name: 'stale',
      scope: 'user',
      target: 'claude',
      hash: '',
      syncedAt: '',
      entry: {},
    };

    const actions = await planMcpApply(undefined, files, ledger, {
      ...options,
      targets: ['claude'],
      prune: true,
    });
    await executeMcpApply(undefined, actions, files, ledger, 'user', new Set());

    const claude = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(claude.mcpServers.stale).toBeUndefined();
    expect(Object.keys(ledger.items)).toEqual([]);
  });

  it('does not rewrite configs whose only actions are skips', async () => {
    const files = await makeFiles();
    await writeFile(
      files.claude,
      JSON.stringify({ mcpServers: { neon: { type: 'http', url: 'https://mine' } } }),
    );

    const ledger = freshLedger();
    const actions = await planMcpApply(source, files, ledger, { ...options, targets: ['claude'] });
    await executeMcpApply(source, actions, files, ledger, 'user', new Set());

    const claude = JSON.parse(await readFile(files.claude, 'utf8'));
    expect(claude.mcpServers.neon.url).toBe('https://mine');
    expect(await readFile(`${files.claude}.skillset-backup`, 'utf8').catch(() => 'absent')).toBe(
      'absent',
    );
  });
});
