import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { readIfExists } from './read-if-exists.js';
import { retryOnWindowsLock } from './file-retry.js';
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

/** The v1 MCP state file: the server names skillset wrote, per tool. Nothing else. */
const v1LedgerSchema = z.strictObject({
  claude: z.array(z.string()).optional(),
  codex: z.array(z.string()).optional(),
});

type V1Ledger = z.infer<typeof v1LedgerSchema>;

function migrateV1(parsed: V1Ledger, migration: LedgerMigration): Ledger {
  const ledger: Ledger = { version: 2, items: {} };

  for (const target of ['claude', 'codex'] as const) {
    const configPath = target === 'claude' ? migration.claudeMcpConfig : migration.codexMcpConfig;
    for (const name of parsed[target] ?? []) {
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

const ledgerItemSchema = z.looseObject({
  kind: z.enum(['skill', 'agent', 'mcp-server', 'instructions', 'hook', 'default']),
  name: z.string(),
  scope: z.enum(['user', 'project']),
  target: z.enum(['claude', 'codex']),
  hash: z.string(),
  syncedAt: z.string(),
  entry: z.unknown().optional(),
});

const ledgerSchema = z.looseObject({
  version: z.literal(2),
  items: z.record(z.string(), ledgerItemSchema),
});

function isLedger(value: unknown): value is Ledger {
  return ledgerSchema.safeParse(value).success;
}

/** The ledger's location and contents, falling back to the legacy location. */
async function readLedgerFile(
  path: string,
  legacyPath: string | undefined,
): Promise<{ source: string; raw: string | undefined }> {
  // Until the ledger has been written at its current location, the one at the
  // previous location is the record of what skillset owns.
  const current = await readIfExists(path);
  if (current !== undefined || legacyPath === undefined || legacyPath === path) {
    return { source: path, raw: current };
  }

  return { source: legacyPath, raw: await readIfExists(legacyPath) };
}

// Treating an unreadable ledger as empty would forget what skillset owns, and
// the next write would make that permanent.
function unreadableLedger(source: string, reason: string): Error {
  return new Error(
    `the ledger at ${source} ${reason}, so skillset can't tell which outputs it owns. Fix it, or move it aside to start over (everything already installed is then treated as hand-installed).`,
  );
}

function parseLedger(raw: string, source: string, migration: LedgerMigration): Ledger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadableLedger(source, 'is not valid JSON');
  }

  if (isLedger(parsed)) return parsed;
  // Only the exact v1 shape migrates: a damaged v2 ledger that lost its version
  // would otherwise migrate to an empty one.
  const v1 = v1LedgerSchema.safeParse(parsed);
  if (v1.success) return migrateV1(v1.data, migration);

  throw unreadableLedger(
    source,
    isMapping(parsed) && parsed['version'] !== undefined && parsed['version'] !== 2
      ? `has version ${JSON.stringify(parsed['version'])}, which this skillset doesn't know`
      : "isn't in a format skillset recognizes",
  );
}

/**
 * Read the ledger, migrating a milestone-2 MCP state file (v1) in place. No
 * ledger yet is an empty one; a ledger that exists but can't be understood is
 * an error, never an empty ledger.
 */
export async function readLedger(
  path: string,
  migration: LedgerMigration,
  legacyPath?: string,
): Promise<Ledger> {
  const { source, raw } = await readLedgerFile(path, legacyPath);
  if (raw === undefined) return { version: 2, items: {} };

  return parseLedger(raw, source, migration);
}

/**
 * Persist the ledger. It records full MCP entries, including `env` values and
 * `headers` that often carry tokens, so it is owner-only (`0600`; Windows
 * ignores the bits). It is written to a new file and renamed over the old one:
 * rewriting in place would put the new secrets in an existing, possibly
 * world-readable inode until a later `chmod`, and a crash in between would leave
 * them there.
 */
/** Whether two paths name the same file on disk, or the second doesn't exist. */
async function sameFile(path: string, other: string): Promise<boolean> {
  if (other === path) return true;
  const [current, previous] = await Promise.all([stat(path), stat(other).catch(() => undefined)]);
  return previous === undefined || (previous.dev === current.dev && previous.ino === current.ino);
}

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
  // Only after the ledger is safely at its new location is the old one retired,
  // and never when both names reach the same file (a symlinked XDG_CONFIG_HOME,
  // say): removing it would delete the ledger just written.
  if (legacyPath !== undefined && !(await sameFile(path, legacyPath))) {
    await retryOnWindowsLock(() => rm(legacyPath, { force: true }));
  }
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
    await retryOnWindowsLock(() => rename(temporary, path));
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
