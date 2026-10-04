import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { checkRecord } from './check-record.js';
import type { Statistics } from './statistics.js';

/** Where Codex keeps rollouts: live sessions by date, and archived ones. */
export function defaultRolloutRoots(): string[] {
  return [join(homedir(), '.codex', 'sessions'), join(homedir(), '.codex', 'archived_sessions')];
}

/** Every `.jsonl` file under the roots, sorted so shards are deterministic. */
export async function listRolloutFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  const pending = [...roots];
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.name.endsWith('.jsonl')) files.push(path);
    }
  }
  return files.toSorted();
}

/**
 * Yields the lines of a file without holding the file in memory. Only `\n`
 * ends a line: `node:readline` also splits on U+2028 and U+2029, which JSON
 * allows unescaped inside a string, and would cut such a record in two.
 */
async function* readLines(path: string): AsyncGenerator<string> {
  let pieces: string[] = [];
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    const text = String(chunk);
    let start = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
      pieces.push(text.slice(start, end));
      yield pieces.join('');
      pieces = [];
      start = end + 1;
    }
    if (start < text.length) pieces.push(text.slice(start));
  }
  if (pieces.length > 0) yield pieces.join('');
}

/**
 * Streams one rollout line by line (never the whole file), checking each
 * record. A line that is not JSON is counted separately, along with whether it
 * was the file's last line, which is what a rollout still being written or cut
 * off by a crash looks like.
 */
export async function checkFile(path: string, statistics: Statistics): Promise<void> {
  statistics.files++;
  let lineNumber = 0;
  let lastNonEmpty = 0;
  const invalid: number[] = [];
  for await (const line of readLines(path)) {
    lineNumber++;
    if (line.trim() === '') continue;
    lastNonEmpty = lineNumber;
    statistics.lines++;
    const location = `${path}:${lineNumber}`;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      invalid.push(lineNumber);
      if (statistics.invalidJson.examples.length < 2)
        statistics.invalidJson.examples.push(location);
      continue;
    }
    checkRecord(record, location, statistics);
  }
  statistics.invalidJson.count += invalid.length;
  if (invalid.length > 0) statistics.invalidJson.filesAffected++;
  statistics.invalidJson.finalLines += invalid.filter((line) => line === lastNonEmpty).length;
}
