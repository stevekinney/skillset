import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isMissingFile, readIfExists } from './read-if-exists.js';
import { withoutByteOrderMark } from './byte-order-mark.js';
import { isMapping } from './frontmatter.js';

/** A sync action against an entry embedded in a shared config file. */
export type EmbeddedAction = {
  target: 'claude' | 'codex';
  kind: 'mcp-server' | 'hook' | 'default';
  name: string;
  /** The config file the action applies to. */
  file: string;
  action: 'write' | 'overwrite' | 'skip-unmanaged' | 'skip-drifted' | 'prune';
};

/**
 * Read a JSON config file as a mapping. A missing file is an empty mapping;
 * anything unparseable or non-object is refused rather than clobbered.
 */
export async function readJsonConfig(path: string): Promise<Record<string, unknown>> {
  const raw = await readIfExists(path);
  if (raw === undefined) return {};

  const parsed: unknown = JSON.parse(withoutByteOrderMark(raw));
  if (!isMapping(parsed)) {
    throw new Error(`${path} is not a JSON object — refusing to edit it`);
  }

  return parsed;
}

/** Write a JSON config file with the project's 2-space formatting. */
export async function writeJsonConfig(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

/** Copy `path` to `path.skillset-backup` once per run (tracked via `backedUp`). */
export async function backupOnce(path: string, backedUp: Set<string>): Promise<void> {
  if (backedUp.has(path)) return;

  backedUp.add(path);
  // No retry on a Windows lock: the config belongs to the user, and whoever
  // holds it may be changing it, which would make the planned edit stale.
  await copyFile(path, `${path}.skillset-backup`).catch((cause: unknown) => {
    // Nothing to back up when the file doesn't exist yet. Any other failure
    // stops the write: editing a config without its backup isn't safe.
    if (!isMissingFile(cause)) throw cause;
  });
}
