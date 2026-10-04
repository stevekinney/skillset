import { describe, expect, it } from 'bun:test';
import { ZodError } from 'zod';

import { eventMessages, responseItems } from '../test/codex-session-fixtures.js';
import {
  CodexSessionJsonlError,
  parseCodexSessionJsonl,
  safeParseCodexSessionJsonl,
} from './codex-session-jsonl.js';

const line = (type: string, payload: unknown) =>
  JSON.stringify({ timestamp: '2026-01-02T03:04:05.678Z', type, payload });

const good = [
  line('event_msg', eventMessages.turn_aborted),
  line('response_item', responseItems.function_call),
].join('\n');

describe('parseCodexSessionJsonl', () => {
  it('parses every line, skipping blank ones', () => {
    const records = parseCodexSessionJsonl(`\n${good}\n\n   \n`);
    expect(records.map((record) => record.type)).toEqual(['event_msg', 'response_item']);
  });

  it('returns no records for an empty file', () => {
    expect(parseCodexSessionJsonl('')).toEqual([]);
  });

  it('does not split a record at an unescaped U+2028 or U+2029', () => {
    const text = JSON.stringify({
      timestamp: 't',
      type: 'response_item',
      payload: { ...responseItems.custom_tool_call_output, output: 'a b c' },
    });
    expect(text).toContain(' ');
    expect(parseCodexSessionJsonl(text)).toHaveLength(1);
  });

  it('reports the line number of a line that is not JSON, counting blank lines', () => {
    const text = `${good}\n\n{"timestamp": "oops`;
    try {
      parseCodexSessionJsonl(text);
      expect.unreachable();
    } catch (error) {
      if (!(error instanceof CodexSessionJsonlError)) throw error;
      const failure = error;
      expect(failure.lineNumber).toBe(4);
      expect(failure.error).toBeInstanceOf(SyntaxError);
      expect(failure.message).toBe('Line 4: not valid JSON');
      expect(failure.cause).toBe(failure.error);
    }
  });

  it('reports the line number and path of a line that fails the schema, without echoing it', () => {
    const text = `${good}\n${line('event_msg', { type: 'turn_aborted', reason: 'secret-value' })}`;
    try {
      parseCodexSessionJsonl(text);
      expect.unreachable();
    } catch (error) {
      if (!(error instanceof CodexSessionJsonlError)) throw error;
      const failure = error;
      expect(failure.name).toBe('CodexSessionJsonlError');
      expect(failure.lineNumber).toBe(3);
      expect(failure.error).toBeInstanceOf(ZodError);
      expect(failure.message).toStartWith('Line 3: does not match the rollout schema at "payload');
      expect(failure.message).not.toContain('secret-value');
    }
  });
});

describe('safeParseCodexSessionJsonl', () => {
  it('returns the records on success', () => {
    const result = safeParseCodexSessionJsonl(good);
    expect(result.success && result.records).toHaveLength(2);
  });

  it('returns the failing line instead of throwing', () => {
    const syntax = safeParseCodexSessionJsonl('not json');
    expect(syntax).toMatchObject({ success: false, lineNumber: 1 });
    const schema = safeParseCodexSessionJsonl(`${good}\n{}`);
    expect(schema).toMatchObject({ success: false, lineNumber: 3 });
  });

  it('describes a failure with no issues as unknown', () => {
    const error = new ZodError([]);
    expect(new CodexSessionJsonlError(9, error).message).toBe(
      'Line 9: does not match the rollout schema at "": unknown issue',
    );
  });
});
