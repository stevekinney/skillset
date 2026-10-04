import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
export async function readLedger(
  path: string,
  migration: LedgerMigration,
  legacyPath?: string,
): Promise<Ledger> {
  // Until the ledger has been written at its current location, the one at the
  // previous location is the record of what skillset owns.
  const current = await readFile(path, 'utf8').catch(() => undefined);
  const raw =
    current === undefined && legacyPath !== undefined && legacyPath !== path
      ? await readFile(legacyPath, 'utf8').catch(() => undefined)
      : current;
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

/**
 * Persist the ledger. It records full MCP entries, including `env` values and
 * `headers` that often carry tokens, so it is owner-only (`0600`; Windows
 * ignores the bits). It is written to a new file and renamed over the old one:
 * rewriting in place would put the new secrets in an existing, possibly
 * world-readable inode until a later `chmod`, and a crash in between would leave
 * them there.
 */
/**
 * Writes in progress, by path. Overlapping writes to one ledger run one after
 * another: on Windows, renaming onto a file another in-flight rename holds open
 * fails with EPERM, and serializing also makes the last write win.
 */
const pendingWrites = new Map<string, Promise<void>>();

export async function writeLedger(
  path: string,
  ledger: Ledger,
  legacyPath?: string,
): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const write = previous.then(
    () => replaceLedger(path, ledger),
    () => replaceLedger(path, ledger),
  );
  pendingWrites.set(path, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(path) === write) pendingWrites.delete(path);
  }
  // Only after the ledger is safely at its new location is the old one retired.
  if (legacyPath !== undefined && legacyPath !== path) await rm(legacyPath, { force: true });
}

async function replaceLedger(path: string, ledger: Ledger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Unique per write, so a stale file from a crashed run with the same PID
  // never collides with this one.
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(ledger, undefined, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true });
    throw cause;
  }
}

/** Record a managed item (mutates the in-memory ledger). */
export function recordItem(ledger: Ledger, key: string, item: Omit<LedgerItem, 'syncedAt'>): void {
  ledger.items[key] = { ...item, syncedAt: new Date().toISOString() };
}

/** Forget a managed item (mutates the in-memory ledger). */
export function forgetItem(ledger: Ledger, key: string): void {
  delete ledger.items[key];
}
