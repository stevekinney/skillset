import type { ZodError } from 'zod';

import { codexSessionRecordSchema, type CodexSessionRecord } from './codex-session-records.js';

/** Why a rollout line could not be read, with the 1-based line number it was on. */
export class CodexSessionJsonlError extends Error {
  readonly lineNumber: number;
  readonly error: SyntaxError | ZodError;

  constructor(lineNumber: number, error: SyntaxError | ZodError) {
    super(`Line ${lineNumber}: ${describe(error)}`, { cause: error });
    this.name = 'CodexSessionJsonlError';
    this.lineNumber = lineNumber;
    this.error = error;
  }
}

/** Never echoes the line itself: rollouts hold conversations. */
function describe(error: SyntaxError | ZodError): string {
  if (error instanceof SyntaxError) return 'not valid JSON';
  const issue = error.issues[0];
  const path = issue?.path.join('.') ?? '';
  return `does not match the rollout schema at "${path}": ${issue?.message ?? 'unknown issue'}`;
}

/** `JSON.parse` only ever throws a `SyntaxError`; this keeps the type honest without a cast. */
function asSyntaxError(error: unknown): SyntaxError {
  return error instanceof SyntaxError ? error : new SyntaxError(String(error));
}

export type CodexSessionJsonlResult =
  | { success: true; records: CodexSessionRecord[] }
  | { success: false; lineNumber: number; error: SyntaxError | ZodError };

/**
 * Parse the text of a rollout file into records, stopping at the first line
 * that fails and reporting its line number. Blank lines are skipped but still
 * counted.
 *
 * Lines end at `\n` only. Splitting on every Unicode line terminator would cut
 * a record in two wherever a message holds an unescaped U+2028 or U+2029,
 * which JSON permits inside a string.
 */
export function safeParseCodexSessionJsonl(text: string): CodexSessionJsonlResult {
  const records: CodexSessionRecord[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      return { success: false, lineNumber: index + 1, error: asSyntaxError(error) };
    }
    const result = codexSessionRecordSchema.safeParse(value);
    if (!result.success) return { success: false, lineNumber: index + 1, error: result.error };
    records.push(result.data);
  }
  return { success: true, records };
}

/** Like {@link safeParseCodexSessionJsonl} but throws a {@link CodexSessionJsonlError}. */
export function parseCodexSessionJsonl(text: string): CodexSessionRecord[] {
  const result = safeParseCodexSessionJsonl(text);
  if (!result.success) throw new CodexSessionJsonlError(result.lineNumber, result.error);
  return result.records;
}
