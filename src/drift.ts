import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { isMapping } from './frontmatter.js';
import { hashContent, structurallyEqual, type LedgerItem } from './ledger.js';

/** The verdict for one managed output during a drift check. */
export type TargetStatus = 'clean' | 'drift' | 'missing';

async function fileItemStatus(key: string, item: LedgerItem): Promise<TargetStatus> {
  const entry = item.entry;
  const files = isMapping(entry) && isMapping(entry['files']) ? entry['files'] : {};

  for (const [relativePath, hash] of Object.entries(files)) {
    const path = relativePath === '' ? key : join(key, relativePath);
    const contents = await readFile(path, 'utf8').catch(() => undefined);
    if (contents === undefined) return 'missing';
    if (typeof hash === 'string' && hashContent(contents) !== hash) return 'drift';
  }

  return 'clean';
}

async function readConfigMapping(file: string): Promise<Record<string, unknown> | undefined> {
  const raw = await readFile(file, 'utf8').catch(() => undefined);
  if (raw === undefined) return undefined;

  try {
    const parsed: unknown = file.endsWith('.toml') ? parseToml(raw) : JSON.parse(raw);

    return isMapping(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function mcpItemStatus(
  config: Record<string, unknown>,
  file: string,
  item: LedgerItem,
): TargetStatus {
  const container = file.endsWith('.toml') ? config['mcp_servers'] : config['mcpServers'];
  const current = isMapping(container) ? container[item.name] : undefined;
  if (current === undefined) return 'missing';

  return structurallyEqual(current, item.entry) ? 'clean' : 'drift';
}

function hookItemStatus(config: Record<string, unknown>, item: LedgerItem): TargetStatus {
  const hooks = config['hooks'];
  const event = item.name.split('/')[0]!;
  const entries =
    isMapping(hooks) && Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];

  return entries.some((entry) => structurallyEqual(entry, item.entry)) ? 'clean' : 'drift';
}

async function embeddedItemStatus(key: string, item: LedgerItem): Promise<TargetStatus> {
  const [file] = key.split('#');
  const config = await readConfigMapping(file!);
  if (config === undefined) return 'missing';

  if (item.kind === 'mcp-server') return mcpItemStatus(config, file!, item);
  if (item.kind === 'hook') return hookItemStatus(config, item);

  return config[item.name] === item.entry ? 'clean' : 'drift';
}

/** Compare one ledger item against the disk state it claims to describe. */
export async function itemStatus(key: string, item: LedgerItem): Promise<TargetStatus> {
  return key.includes('#') ? embeddedItemStatus(key, item) : fileItemStatus(key, item);
}
