import { describe, expect, it } from 'bun:test';

import {
  ClaudeSessionJsonlError,
  parseClaudeSessionJsonl,
  safeParseClaudeSessionJsonl,
} from './claude-session-jsonl.js';

/** The error a function throws; the test fails if it does not throw. */
function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected the function to throw an Error');
}

const title = JSON.stringify({ type: 'ai-title', sessionId: 's-1', aiTitle: 'A title' });
const mode = JSON.stringify({ type: 'mode', sessionId: 's-1', mode: 'normal' });

describe('safeParseClaudeSessionJsonl', () => {
  it('parses one record per line and ignores blank lines and the trailing newline', () => {
    const { records, failures } = safeParseClaudeSessionJsonl(`${title}\n\n${mode}\n`);
    expect(failures).toEqual([]);
    expect(records.map((record) => record.type)).toEqual(['ai-title', 'mode']);
  });

  it('parses text with no trailing newline and with CRLF line endings', () => {
    expect(safeParseClaudeSessionJsonl(title).records).toHaveLength(1);
    expect(safeParseClaudeSessionJsonl(`${title}\r\n${mode}\r\n`).records).toHaveLength(2);
  });

  it('returns nothing for empty text', () => {
    expect(safeParseClaudeSessionJsonl('')).toEqual({ records: [], failures: [] });
  });

  it('reports the line number of a failure and keeps parsing after it', () => {
    const { records, failures } = safeParseClaudeSessionJsonl(
      `${title}\n${JSON.stringify({ type: 'mode', sessionId: 's-1', mode: 'bogus' })}\n${mode}`,
    );
    expect(records).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.line).toBe(2);
    expect(failures[0]?.kind).toBe('schema');
    expect(failures[0]?.issues?.[0]?.path).toEqual(['mode']);
  });

  it('tells invalid JSON apart from a record the schema rejects', () => {
    const { failures } = safeParseClaudeSessionJsonl(`${title}\n{"type": "mode"\n{"type":"nope"}`);
    expect(failures.map((failure) => [failure.line, failure.kind])).toEqual([
      [2, 'json'],
      [3, 'schema'],
    ]);
    expect(failures[0]?.issues).toBeUndefined();
    expect(failures[0]?.message.length).toBeGreaterThan(0);
  });

  it('counts blank lines when numbering', () => {
    const { failures } = safeParseClaudeSessionJsonl(`\n\n[1]`);
    expect(failures[0]?.line).toBe(3);
  });
});

describe('parseClaudeSessionJsonl', () => {
  it('returns the records when every line parses', () => {
    expect(parseClaudeSessionJsonl(`${title}\n${mode}\n`)).toHaveLength(2);
  });

  it('throws an error naming the first bad line and the count of the rest', () => {
    const error = thrownBy(() => parseClaudeSessionJsonl(`${title}\nnot json\n{"type":"nope"}`));
    expect(error).toBeInstanceOf(ClaudeSessionJsonlError);
    expect(error.message).toContain('line 2');
    expect(error.message).toContain('and 1 more');
    expect(error instanceof ClaudeSessionJsonlError && error.failures).toHaveLength(2);
  });

  it('omits the count when exactly one line fails', () => {
    const error = thrownBy(() => parseClaudeSessionJsonl('not json'));
    expect(error.message).toMatch(/line 1: /);
    expect(error.message).not.toContain('more');
  });
});
