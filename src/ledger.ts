import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Target } from './frontmatter.js';
import { isMapping } from './frontmatter.js';
import type { Scope } from './targets.js';

/** Every kind of output the ledger tracks. */
export type LedgerItemKind = 'skill' | 'agent' | 'mcp-server' | 'instructions' | 'hook' | 'default';

/** One managed output: what we last wrote, where, and when. */
export type LedgerItem = {
  kind: LedgerItemKind;
  name: string;
  scope: Scope;
  target: Target;
  /** `sha256:<hex>` of the content we last wrote ('' = pre-ledger, unverifiable). */
  hash: string;
  /** ISO timestamp of the last sync that wrote this item ('' = unknown). */
  syncedAt: string;
  /** For embedded kinds (mcp-server/hook/default): the exact managed value. */
  entry?: unknown;
};

/**
 * The sync ledger: skillset's record of everything it manages. Keys are the
 * absolute target path for file kinds, or `<config-path>#<kind>:<name>` for
 * entries embedded in shared config files.
 */
export type Ledger = {
  version: 2;
  items: Record<string, LedgerItem>;
};

/** The ledger key for a file-kind item (skill directory, agent file, …). */
export function fileKey(path: string): string {
  return path;
}

/** The ledger key for an entry embedded in a shared config file. */
export function embeddedKey(
  configPath: string,
  kind: 'mcp-server' | 'hook' | 'default',
  name: string,
): string {
  return `${configPath}#${kind}:${name}`;
}

/** Hash file contents the way the ledger stores them. */
export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isMapping(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    sorted[key] = sortValue(value[key]);
  }

  return sorted;
}

/** Key-order-independent JSON serialization, for structural comparison. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/** True when two values are structurally equal regardless of key order. */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** The paths the v1 (milestone 2) MCP state file mapped onto. */
export type LedgerMigration = {
  claudeMcpConfig: string;
  codexMcpConfig: string;
};

function migrateV1(parsed: Record<string, unknown>, migration: LedgerMigration): Ledger {
  const ledger: Ledger = { version: 2, items: {} };

  for (const target of ['claude', 'codex'] as const) {
    const names = parsed[target];
    if (!Array.isArray(names)) continue;

    const configPath = target === 'claude' ? migration.claudeMcpConfig : migration.codexMcpConfig;
    for (const name of names.filter((candidate) => typeof candidate === 'string')) {
      ledger.items[embeddedKey(configPath, 'mcp-server', name)] = {
        kind: 'mcp-server',
        name,
        scope: 'user',
        target,
        hash: '',
        syncedAt: '',
      };
    }
  }

  return ledger;
}

function isLedger(value: unknown): value is Ledger {
  return isMapping(value) && value['version'] === 2 && isMapping(value['items']);
}

/**
 * Read the ledger, migrating a milestone-2 MCP state file (v1) in place and
 * starting fresh on anything unreadable.
 */
export async function readLedger(path: string, migration: LedgerMigration): Promise<Ledger> {
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return { version: 2, items: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: 2, items: {} };
  }

  if (isLedger(parsed)) return parsed;
  if (isMapping(parsed) && parsed['version'] === undefined) return migrateV1(parsed, migration);

  return { version: 2, items: {} };
}

/** Persist the ledger. */
export async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, undefined, 2)}\n`, 'utf8');
}

/** Record a managed item (mutates the in-memory ledger). */
export function recordItem(ledger: Ledger, key: string, item: Omit<LedgerItem, 'syncedAt'>): void {
  ledger.items[key] = { ...item, syncedAt: new Date().toISOString() };
}

/** Forget a managed item (mutates the in-memory ledger). */
export function forgetItem(ledger: Ledger, key: string): void {
  delete ledger.items[key];
}
