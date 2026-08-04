import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import {
  backupOnce,
  readJsonConfig,
  writeJsonConfig,
  type EmbeddedAction,
} from './config-files.js';
import { isMapping, type Target } from './frontmatter.js';
import {
  embeddedKey,
  forgetItem,
  hashContent,
  recordItem,
  stableStringify,
  structurallyEqual,
  type Ledger,
} from './ledger.js';
import { claudeMcpEntry, codexMcpSection, type ParsedMcpSource } from './mcp-config.js';
import { spliceTomlSection } from './toml-splice.js';
import type { Scope } from './targets.js';

/** The two config files MCP sync edits for one scope. */
export type McpConfigFiles = Record<Target, string>;

/** Options for {@link planMcpApply}. */
export type McpApplyOptions = {
  targets: Target[];
  scope: Scope;
  prune: boolean;
  force: boolean;
};

function claudeServers(config: Record<string, unknown>): Record<string, unknown> {
  const servers = config['mcpServers'];

  return isMapping(servers) ? servers : {};
}

async function codexServers(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return {};

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch {
    throw new Error(`${path} is not valid TOML — refusing to edit it`);
  }

  const servers = isMapping(parsed) ? parsed['mcp_servers'] : undefined;

  return isMapping(servers) ? servers : {};
}

async function existingServers(target: Target, file: string): Promise<Record<string, unknown>> {
  return target === 'claude' ? claudeServers(await readJsonConfig(file)) : codexServers(file);
}

function desiredEntry(source: ParsedMcpSource, target: Target, name: string): unknown {
  const server = source.source.servers[name]!;

  return target === 'claude' ? claudeMcpEntry(server) : codexMcpSection(server);
}

function resolveEntryAction(
  current: unknown,
  managedEntry: unknown,
  force: boolean,
): EmbeddedAction['action'] {
  if (current === undefined) return 'write';
  if (force) return 'overwrite';
  if (managedEntry === undefined) return 'skip-unmanaged';

  return structurallyEqual(current, managedEntry) ? 'overwrite' : 'skip-drifted';
}

/**
 * Compute the MCP action list without touching disk. Ownership and drift come
 * from the ledger: entries we previously wrote are overwritten when unchanged
 * on disk, skipped with a drift warning when hand-edited, and pruned only
 * when they left the source.
 */
async function planMcpTarget(
  sourceNames: string[],
  target: Target,
  file: string,
  ledger: Ledger,
  options: McpApplyOptions,
): Promise<EmbeddedAction[]> {
  const existing = await existingServers(target, file);
  const actions: EmbeddedAction[] = sourceNames.map((name) => ({
    target,
    kind: 'mcp-server',
    name,
    file,
    action: resolveEntryAction(
      existing[name],
      ledger.items[embeddedKey(file, 'mcp-server', name)]?.entry,
      options.force,
    ),
  }));

  if (!options.prune) return actions;

  for (const [key, item] of Object.entries(ledger.items)) {
    if (item.kind !== 'mcp-server' || !key.startsWith(`${file}#`)) continue;
    if (sourceNames.includes(item.name)) continue;

    actions.push({ target, kind: 'mcp-server', name: item.name, file, action: 'prune' });
  }

  return actions;
}

export async function planMcpApply(
  source: ParsedMcpSource | undefined,
  files: McpConfigFiles,
  ledger: Ledger,
  options: McpApplyOptions,
): Promise<EmbeddedAction[]> {
  const sourceNames = Object.keys(source?.source.servers ?? {});
  const actions: EmbeddedAction[] = [];

  for (const target of options.targets) {
    actions.push(...(await planMcpTarget(sourceNames, target, files[target], ledger, options)));
  }

  return actions;
}

function effective(actions: EmbeddedAction[]): EmbeddedAction[] {
  return actions.filter(
    (action) => action.action !== 'skip-unmanaged' && action.action !== 'skip-drifted',
  );
}

async function applyClaude(
  source: ParsedMcpSource | undefined,
  actions: EmbeddedAction[],
  file: string,
): Promise<void> {
  const config = await readJsonConfig(file);
  const servers = claudeServers(config);

  for (const action of actions) {
    if (action.action === 'prune') {
      delete servers[action.name];
    } else {
      servers[action.name] = desiredEntry(source!, 'claude', action.name);
    }
  }

  config['mcpServers'] = servers;
  await writeJsonConfig(file, config);
}

async function applyCodex(
  source: ParsedMcpSource | undefined,
  actions: EmbeddedAction[],
  file: string,
): Promise<void> {
  let contents = await readFile(file, 'utf8').catch(() => '');

  for (const action of actions) {
    const replacement =
      action.action === 'prune'
        ? undefined
        : stringifyToml({
            mcp_servers: { [action.name]: desiredEntry(source!, 'codex', action.name) },
          });

    contents = spliceTomlSection(contents, `mcp_servers.${action.name}`, replacement);
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
}

/**
 * Execute a previously computed MCP plan: back up each touched config once,
 * apply the edits, and update the ledger.
 */
export async function executeMcpApply(
  source: ParsedMcpSource | undefined,
  actions: EmbeddedAction[],
  files: McpConfigFiles,
  ledger: Ledger,
  scope: Scope,
  backedUp: Set<string>,
): Promise<void> {
  for (const target of ['claude', 'codex'] as const) {
    const targetActions = effective(actions).filter((action) => action.target === target);
    if (targetActions.length === 0) continue;

    const file = files[target];
    await backupOnce(file, backedUp);

    if (target === 'claude') {
      await applyClaude(source, targetActions, file);
    } else {
      await applyCodex(source, targetActions, file);
    }

    for (const action of targetActions) {
      const key = embeddedKey(file, 'mcp-server', action.name);

      if (action.action === 'prune') {
        forgetItem(ledger, key);
      } else {
        const entry = desiredEntry(source!, target, action.name);
        recordItem(ledger, key, {
          kind: 'mcp-server',
          name: action.name,
          scope,
          target,
          hash: hashContent(stableStringify(entry)),
          entry,
        });
      }
    }
  }
}
