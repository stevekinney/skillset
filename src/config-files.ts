import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return {};

  const parsed: unknown = JSON.parse(raw);
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
  await copyFile(path, `${path}.skillset-backup`).catch(() => {
    // Nothing to back up when the file does not exist yet.
  });
}
