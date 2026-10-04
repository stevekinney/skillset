import { describe, expect, it } from 'bun:test';

import { eventMessages, otherPayloads, responseItems } from '../test/codex-session-fixtures.js';
import { codexEventMessageSchemas, codexEventMessageTypes } from './codex-session-events.js';
import {
  codexResponseItemTypes,
  codexSessionRecordSchema,
  codexSessionRecordSchemas,
  codexSessionRecordTypes,
  parseCodexSessionRecord,
  safeParseCodexSessionRecord,
  type CodexEventMessageFor,
  type CodexResponseItemFor,
  type CodexSessionPayloadFor,
  type CodexSessionRecordFor,
} from './codex-session-records.js';

const envelope = { timestamp: '2026-01-02T03:04:05.678Z' };

const recordFor = (type: string, payload: unknown, extra: object = {}) => ({
  ...envelope,
  type,
  payload,
  ...extra,
});

describe('codexSessionRecordTypes', () => {
  it('names exactly the record schemas', () => {
    const names: string[] = [...codexSessionRecordTypes];
    expect(names.toSorted()).toEqual(Object.keys(codexSessionRecordSchemas).toSorted());
  });
});

describe('response_item records', () => {
  it('names exactly the response item payload types', () => {
    const names: string[] = [...codexResponseItemTypes];
    expect(names.toSorted()).toEqual(Object.keys(responseItems).toSorted());
  });

  for (const [type, payload] of Object.entries(responseItems)) {
    it(`parses a ${type} payload`, () => {
      const parsed = parseCodexSessionRecord(recordFor('response_item', payload));
      expect(parsed).toMatchObject({ type: 'response_item', payload: { type } });
    });
  }

  it('parses the harness metadata that sits beside the payload', () => {
    const parsed = parseCodexSessionRecord(
      recordFor('response_item', responseItems.message, {
        ordinal: 7,
        metadata: {
          client_authored: false,
          user_input_order: 2,
          mcp_attribution: {
            status: 'complete',
            sources: [{ server_name: 's', tool_name: 't', first_turn_id: 'turn-1' }],
          },
          retained_source: {
            complete: true,
            id: { message_id: 'm', role: 'user', turn_id: 'turn-1' },
            revision: 'r',
          },
        },
      }),
    );
    expect(parsed.ordinal).toBe(7);
    const failed = recordFor('response_item', responseItems.message, {
      metadata: {
        mcp_attribution: { status: 'attribution_error', error_reason: 'payload_too_large' },
      },
    });
    expect(safeParseCodexSessionRecord(failed).success).toBe(true);
  });

  it('rejects a role, status, or content type outside the closed sets', () => {
    for (const payload of [
      { ...responseItems.message, role: 'robot' },
      { ...responseItems.web_search_call, status: 'weird' },
      { ...responseItems.message, content: [{ type: 'output_video', text: 'x' }] },
    ]) {
      expect(safeParseCodexSessionRecord(recordFor('response_item', payload)).success).toBe(false);
    }
  });
});

describe('event_msg records', () => {
  it('names exactly the event payload types', () => {
    const names: string[] = [...codexEventMessageTypes];
    expect(names.toSorted()).toEqual(Object.keys(eventMessages).toSorted());
    expect(Object.keys(codexEventMessageSchemas).toSorted()).toEqual(names.toSorted());
  });

  for (const [type, payload] of Object.entries(eventMessages)) {
    it(`parses a ${type} payload`, () => {
      expect(parseCodexSessionRecord(recordFor('event_msg', payload))).toMatchObject({
        type: 'event_msg',
        payload: { type },
      });
    });
  }

  it('accepts every error info Codex writes, bare or with a status code', () => {
    for (const codex_error_info of [
      'cyber_policy',
      { http_connection_failed: { http_status_code: 502 } },
      { active_turn_not_steerable: { turn_kind: 'review' } },
      { response_stream_disconnected: { http_status_code: null } },
      null,
    ]) {
      const payload = {
        ...eventMessages.task_complete,
        error: { message: 'm', codex_error_info },
      };
      expect(safeParseCodexSessionRecord(recordFor('event_msg', payload)).success).toBe(true);
    }
  });

  it('rejects an unknown payload type and a reason outside the closed set', () => {
    for (const payload of [
      { type: 'brand_new_event' },
      { ...eventMessages.turn_aborted, reason: 'because' },
    ]) {
      expect(safeParseCodexSessionRecord(recordFor('event_msg', payload)).success).toBe(false);
    }
  });
});

describe('other record types', () => {
  for (const [type, payload] of Object.entries(otherPayloads)) {
    it(`parses a ${type} record`, () => {
      const parsed: string = parseCodexSessionRecord(recordFor(type, payload)).type;
      expect(parsed).toBe(type);
    });
  }

  it('reads every session source Codex writes', () => {
    for (const source of [
      'cli',
      'vscode',
      'exec',
      'mcp',
      'unknown',
      { custom: 'my-client' },
      { internal: 'guardian' },
      { subagent: 'review' },
      { subagent: { other: 'guardian' } },
    ]) {
      const payload = { ...otherPayloads.session_meta, source };
      expect(safeParseCodexSessionRecord(recordFor('session_meta', payload)).success).toBe(true);
    }
  });

  it('keeps a thread source or originator it has never seen', () => {
    const payload = {
      ...otherPayloads.session_meta,
      thread_source: 'a_new_feature',
      originator: 'a_new_client',
    };
    expect(safeParseCodexSessionRecord(recordFor('session_meta', payload)).success).toBe(true);
  });

  it('reads every sandbox and permission profile shape', () => {
    for (const sandbox_policy of [
      { type: 'danger-full-access' },
      { type: 'read-only' },
      { type: 'external-sandbox', network_access: 'enabled' },
      { type: 'workspace-write', writable_roots: ['/a'], exclude_slash_tmp: true },
    ]) {
      const payload = { ...otherPayloads.turn_context, sandbox_policy };
      expect(safeParseCodexSessionRecord(recordFor('turn_context', payload)).success).toBe(true);
    }
    for (const permission_profile of [
      { type: 'disabled' },
      { type: 'external', network: 'enabled' },
      { type: 'managed', file_system: { type: 'unrestricted' }, network: 'enabled' },
      {
        type: 'managed',
        file_system: {
          type: 'restricted',
          entries: [
            { path: { type: 'glob_pattern', pattern: '*.env' }, access: 'deny' },
            { path: { type: 'special', value: { kind: 'unknown', path: 'x' } }, access: 'none' },
          ],
        },
        network: 'restricted',
      },
    ]) {
      const payload = { ...otherPayloads.turn_context, permission_profile };
      expect(safeParseCodexSessionRecord(recordFor('turn_context', payload)).success).toBe(true);
    }
  });

  it('keeps a reasoning effort or multi-agent mode it has never seen', () => {
    const payload = {
      ...otherPayloads.turn_context,
      effort: 'a_future_level',
      multi_agent_mode: 'a_custom_mode',
    };
    expect(safeParseCodexSessionRecord(recordFor('turn_context', payload)).success).toBe(true);
  });

  it('rejects an approval policy outside the closed set', () => {
    const payload = { ...otherPayloads.turn_context, approval_policy: 'sometimes' };
    expect(safeParseCodexSessionRecord(recordFor('turn_context', payload)).success).toBe(false);
  });
});

describe('codexSessionRecordSchema', () => {
  it('keeps fields a newer Codex adds', () => {
    const record = recordFor(
      'event_msg',
      { ...eventMessages.turn_aborted, added_later: { a: 1 } },
      {
        also_new: true,
      },
    );
    expect(parseCodexSessionRecord(record)).toMatchObject({
      also_new: true,
      payload: { added_later: { a: 1 } },
    });
  });

  it('rejects an unknown record type, a missing timestamp, and a missing payload', () => {
    for (const value of [
      recordFor('brand_new_record', {}),
      { type: 'event_msg', payload: eventMessages.turn_aborted },
      { ...envelope, type: 'turn_context' },
      'not an object',
    ]) {
      expect(codexSessionRecordSchema.safeParse(value).success).toBe(false);
      expect(() => parseCodexSessionRecord(value)).toThrow();
    }
  });

  it('narrows by record type, response item type, and event type', () => {
    const record = parseCodexSessionRecord(recordFor('event_msg', eventMessages.token_count));
    if (record.type !== 'event_msg') throw new Error('expected an event_msg record');
    const eventRecord: CodexSessionRecordFor<'event_msg'> = record;
    const payload: CodexSessionPayloadFor<'event_msg'> = eventRecord.payload;
    if (payload.type !== 'token_count') throw new Error('expected a token_count event');
    const tokenCount: CodexEventMessageFor<'token_count'> = payload;
    const call: CodexResponseItemFor<'function_call'> = responseItems.function_call;
    expect(tokenCount.info?.total_token_usage.total_tokens).toBe(13);
    expect(call.name).toBe('exec_command');
  });
});
