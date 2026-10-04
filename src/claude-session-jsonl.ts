import type { z } from 'zod';

import {
  safeParseClaudeSessionRecord,
  type ClaudeSessionRecord,
} from './claude-session-record-schema.js';

/** One line of a session transcript that did not parse. */
export interface ClaudeSessionJsonlFailure {
  /** 1-based line number within the text. */
  line: number;
  /** `json` when the line is not valid JSON; `schema` when it is JSON but not a session record. */
  kind: 'json' | 'schema';
  message: string;
  /** The schema issues, for `schema` failures. */
  issues?: z.core.$ZodIssue[];
}

/** The outcome of parsing a whole transcript: every record that parsed and every line that did not. */
export interface ClaudeSessionJsonlResult {
  records: ClaudeSessionRecord[];
  failures: ClaudeSessionJsonlFailure[];
}

/** Thrown by {@link parseClaudeSessionJsonl}; carries every failing line. */
export class ClaudeSessionJsonlError extends Error {
  readonly failures: ClaudeSessionJsonlFailure[];

  constructor(failures: ClaudeSessionJsonlFailure[]) {
    const first = failures[0];
    const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
    super(`Invalid session transcript: line ${first?.line}: ${first?.message}${more}`);
    this.name = 'ClaudeSessionJsonlError';
    this.failures = failures;
  }
}

/**
 * Parse a whole session transcript, one record per line. Blank lines are
 * skipped. A bad line never stops the rest: every failure is reported with its
 * line number.
 */
export function safeParseClaudeSessionJsonl(text: string): ClaudeSessionJsonlResult {
  const records: ClaudeSessionRecord[] = [];
  const failures: ClaudeSessionJsonlFailure[] = [];

  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      // `JSON.parse` only ever throws a `SyntaxError`.
      const message = error instanceof SyntaxError ? error.message : 'Invalid JSON';
      failures.push({ line: index + 1, kind: 'json', message });
      continue;
    }

    const result = safeParseClaudeSessionRecord(value);
    if (result.success) records.push(result.data);
    else
      failures.push({
        line: index + 1,
        kind: 'schema',
        message: result.error.issues[0]?.message ?? 'Invalid record',
        issues: result.error.issues,
      });
  }

  return { records, failures };
}

/** Like {@link safeParseClaudeSessionJsonl} but throws a {@link ClaudeSessionJsonlError} on any bad line. */
export function parseClaudeSessionJsonl(text: string): ClaudeSessionRecord[] {
  const { records, failures } = safeParseClaudeSessionJsonl(text);
  if (failures.length > 0) throw new ClaudeSessionJsonlError(failures);
  return records;
}
