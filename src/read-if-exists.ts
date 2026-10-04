import { readFile } from 'node:fs/promises';

/** Whether an error means the path doesn't exist (as opposed to existing but unreadable). */
export function isMissingFile(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;

  return cause.code === 'ENOENT' || cause.code === 'ENOTDIR';
}

/**
 * Read a text file, or `undefined` when it doesn't exist. Any other failure (a
 * file another program has locked, or one skillset may not read) throws: read
 * as "empty", a shared config would be rewritten with only skillset's entries.
 */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw cause;
  }
}
