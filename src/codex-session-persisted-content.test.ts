import { describe, expect, it } from 'bun:test';

import { eventMessages, responseItems } from '../test/codex-session-fixtures.js';
import { parseCodexSessionRecord, safeParseCodexSessionRecord } from './codex-session-records.js';
import { codexResponseItemSchema } from './codex-session-response-items.js';
import { codexTurnItemSchema } from './codex-session-turn-items.js';

const recordFor = (type: string, payload: unknown) => ({
  timestamp: '2026-01-02T03:04:05.678Z',
  type,
  payload,
});

describe('persisted Codex 0.171 content', () => {
  it('reads standalone image generations by file ID or inline result', () => {
    const base = {
      type: 'Extension',
      kind: 'image_gen.generation',
      id: 'image-fixture',
      status: 'completed',
      revisedPrompt: null,
    };
    const inline = { ...base, result: 'fixture-bytes' };
    const file = {
      ...base,
      fileId: 'file-fixture',
      generationId: 'generation-fixture',
      inputImages: [{ path: '/fixture/image.png', sha256: 'ab'.repeat(32) }],
    };
    expect(codexTurnItemSchema.parse({ ...inline, fileId: null })).toMatchObject(inline);
    expect(codexTurnItemSchema.parse(file)).toMatchObject(file);
    const migrated = codexTurnItemSchema.parse({ ...file, result: 'stale-inline' });
    expect(migrated).toMatchObject(file);
    expect(migrated).not.toHaveProperty('result');
    expect(codexTurnItemSchema.safeParse(base).success).toBe(false);
    expect(
      codexTurnItemSchema.safeParse({ ...file, inputImages: [{ path: '/fixture/image.png' }] })
        .success,
    ).toBe(false);
    expect(
      codexTurnItemSchema.safeParse({
        type: 'ImageGeneration',
        id: 'i',
        status: 'completed',
        fileId: 'file-fixture',
      }).success,
    ).toBe(false);
  });

  it('types completed item token counts and restores the legacy completion default', () => {
    const completion = {
      type: 'item_completed',
      thread_id: 'thread-fixture',
      turn_id: 'turn-fixture',
      item: { type: 'AgentMessage', id: 'item-1', content: [] },
      completed_at_ms: 1050,
    };
    const counted = { ...completion, content_token_count: 12 };
    expect(parseCodexSessionRecord(recordFor('event_msg', counted))).toMatchObject({
      payload: counted,
    });
    expect(
      safeParseCodexSessionRecord(recordFor('event_msg', { ...counted, content_token_count: -1 }))
        .success,
    ).toBe(false);
    const legacy = {
      ...completion,
      item: { type: 'Plan', id: 'plan-1', text: 'fixture plan' },
      completed_at_ms: undefined,
    };
    expect(parseCodexSessionRecord(recordFor('event_msg', legacy))).toMatchObject({
      payload: { completed_at_ms: 0 },
    });
  });

  it('reads realtime frames and the older transcript spelling', () => {
    const base = { id: 'event-fixture', realtime_session_id: 'voice-fixture' };
    const transcript = { role: 'assistant', text: 'fixture answer' };
    const frame = {
      ...base,
      type: 'frame',
      observed_at_ms: 1050,
      channels: { voice_transcript: transcript },
    };
    const legacy = { ...base, type: 'transcript_segment', ...transcript };
    for (const payload of [frame, legacy]) {
      expect(parseCodexSessionRecord(recordFor('realtime_item', payload))).toMatchObject({
        payload,
      });
    }
    for (const payload of [
      { ...frame, observed_at_ms: '1050' },
      { ...frame, channels: {} },
      { ...legacy, role: 'developer' },
    ]) {
      expect(safeParseCodexSessionRecord(recordFor('realtime_item', payload)).success).toBe(false);
    }
  });

  it('reads each remaining realtime event in its stored form', () => {
    const base = { id: 'event-fixture', realtime_session_id: 'voice-fixture' };
    const input = { source_event_ids: ['frame-1'], input_item_id: 'input-1', input: 'fixture' };
    for (const variant of [
      { type: 'realtime_session_started' },
      { type: 'realtime_session_closed', outcome: 'ended' },
      {
        type: 'bem_item_promoted',
        turn_id: 'turn-1',
        item_id: 'item-1',
        presentation: { type: 'whole_item' },
      },
      {
        type: 'bem_item_promoted',
        turn_id: 'turn-1',
        item_id: 'item-1',
        presentation: { type: 'inline_markdown' },
      },
      {
        type: 'bem_item_promoted',
        turn_id: 'turn-1',
        item_id: 'item-1',
        presentation: { type: 'inline_visualization', index: 0 },
      },
      {
        type: 'turn_input_accepted',
        handoff_id: 'handoff-1',
        turn_id: 'turn-1',
        mode: 'steer',
        ...input,
      },
      { type: 'session_end_input_saved', ...input },
    ]) {
      const payload = { ...base, ...variant };
      expect(parseCodexSessionRecord(recordFor('realtime_item', payload))).toMatchObject({
        payload,
      });
    }
    expect(
      safeParseCodexSessionRecord(
        recordFor('realtime_item', { ...base, type: 'turn_input_accepted', ...input }),
      ).success,
    ).toBe(false);
  });

  it('retains the tagged moderation display variants on completed messages', () => {
    const item = { type: 'AgentMessage', id: 'item-1', content: [] };
    const base = { version: 1 };
    for (const display of [
      {
        ...base,
        mode: 'show',
        trustedContacts: 'skip',
        annotation: { kind: 'wellbeingHelpline', subject: 'answer' },
      },
      { ...base, mode: 'hide', replacement: { kind: 'wellbeingPromptHelpline' } },
      { ...base, mode: 'show', trustedContacts: 'check', annotation: null },
      { ...base, mode: 'block', reason: { kind: 'protection', protectionType: 'fixture' } },
      { ...base, mode: 'block', reason: { kind: 'cyber', trustedAccess: false } },
      { ...base, mode: 'block', reason: { kind: 'cyber', trustedAccess: null } },
    ]) {
      const moderation = { moderated: true, display };
      expect(codexTurnItemSchema.parse({ ...item, moderation })).toMatchObject({ moderation });
    }
    expect(
      codexTurnItemSchema.safeParse({ ...item, moderation: { moderated: true } }).success,
    ).toBe(true);
  });

  it('keeps a recovered answer restricted when its stored display cannot be read', () => {
    const item = { type: 'AgentMessage', id: 'item-1', content: [] };
    for (const display of [{ mode: 'show', version: 2 }, { mode: 'unknown' }, false]) {
      const parsed = codexTurnItemSchema.parse({
        ...item,
        moderation: { moderated: false, display },
      });
      expect(parsed).toMatchObject({ moderation: { moderated: true } });
      expect(parsed['moderation']).not.toHaveProperty('display');
    }
    const parsed = codexTurnItemSchema.parse({
      ...item,
      moderation: { moderated: false, display: null },
    });
    expect(parsed).toMatchObject({ moderation: { moderated: false } });
    expect(parsed['moderation']).not.toHaveProperty('display');
    expect(codexTurnItemSchema.safeParse({ ...item, moderation: { display: null } }).success).toBe(
      false,
    );
  });

  it('preserves partial answers in raw responses and completed turn items', () => {
    const message = { ...responseItems.message, phase: 'partial_answer' };
    const turnItem = {
      type: 'AgentMessage',
      id: 'item-1',
      phase: 'partial_answer',
      content: [{ type: 'Text', text: 'partial answer' }],
    };
    expect(codexResponseItemSchema.parse(message)).toMatchObject(message);
    expect(codexTurnItemSchema.parse(turnItem)).toMatchObject(turnItem);
  });

  it('reads file-backed audio in messages, tool outputs, and user turn items', () => {
    const audio = { type: 'input_audio', file_id: 'file-fixture' };
    const message = { ...responseItems.message, content: [audio] };
    const toolOutput = { ...responseItems.function_call_output, output: [audio] };
    const user = {
      type: 'UserMessage',
      id: 'item-1',
      content: [{ ...audio, type: 'audio' }],
    };
    expect(codexResponseItemSchema.parse(message)).toMatchObject(message);
    expect(codexResponseItemSchema.parse(toolOutput)).toMatchObject(toolOutput);
    expect(codexTurnItemSchema.parse(user)).toMatchObject(user);
    expect(
      codexResponseItemSchema.safeParse({ ...message, content: [{ type: 'input_audio' }] }).success,
    ).toBe(false);
    expect(
      codexTurnItemSchema.safeParse({ ...user, content: [{ type: 'audio', file_id: 123 }] })
        .success,
    ).toBe(false);
  });

  it('validates the opaque response content where Codex persists it', () => {
    const items = [
      responseItems.message,
      responseItems.local_shell_call,
      responseItems.function_call,
      responseItems.tool_search_call,
      responseItems.custom_tool_call,
      responseItems.web_search_call,
      responseItems.image_generation_call,
    ];
    for (const item of items) {
      const sample = { ...item, encrypted_content: 'fixture-opaque' };
      expect(codexResponseItemSchema.parse(sample)).toMatchObject(sample);
      expect(codexResponseItemSchema.safeParse({ ...sample, encrypted_content: {} }).success).toBe(
        false,
      );
    }
  });

  it('types registration environment separately from an MCP call result', () => {
    const call = {
      type: 'McpToolCall',
      id: 'item-1',
      server: 'fixture',
      tool: 'echo',
      arguments: {},
      status: 'completed',
      environmentId: 'environment-fixture',
    };
    expect(codexTurnItemSchema.parse(call)).toMatchObject(call);
    expect(codexTurnItemSchema.safeParse({ ...call, environmentId: true }).success).toBe(false);
  });

  it('accepts every error info Codex writes, bare or with a status code', () => {
    for (const codex_error_info of [
      'cyber_policy',
      'model_not_found',
      'policy_capacity_unavailable',
      'inference_hook_denied',
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

  it('accepts science plan names on persisted token counts', () => {
    for (const plan_type of ['sci', 'sci_plus']) {
      const payload = {
        ...eventMessages.token_count,
        rate_limits: { ...eventMessages.token_count.rate_limits, plan_type },
      };
      expect(parseCodexSessionRecord(recordFor('event_msg', payload))).toMatchObject({
        payload: { rate_limits: { plan_type } },
      });
    }
  });

  it('validates rejected audio IDs recorded with terminal turn errors', () => {
    const payload = {
      ...eventMessages.task_complete,
      error: { message: 'fixture', rejected_audio_file_ids: ['file-fixture'] },
    };
    expect(parseCodexSessionRecord(recordFor('event_msg', payload))).toMatchObject({ payload });
    const invalid = { ...payload, error: { ...payload.error, rejected_audio_file_ids: [false] } };
    expect(safeParseCodexSessionRecord(recordFor('event_msg', invalid)).success).toBe(false);
  });
});
