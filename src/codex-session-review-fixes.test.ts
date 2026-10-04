import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { responseItems } from '../test/codex-session-fixtures.js';
import { codexEventMessageSchemas } from './codex-session-events.js';
import type { CodexResponseItemFor } from './codex-session-records.js';
import { buildCodexResponseItemSchema } from './codex-session-response-items.js';

describe('compaction response items', () => {
  it('narrow to each compaction type on its own', () => {
    const compaction: CodexResponseItemFor<'compaction'> = responseItems.compaction;
    const summary: CodexResponseItemFor<'compaction_summary'> = responseItems.compaction_summary;
    expect([compaction.type, summary.type]).toEqual(['compaction', 'compaction_summary']);
  });
});

const taskComplete = (codexErrorInfo: unknown) =>
  codexEventMessageSchemas.task_complete.safeParse({
    type: 'task_complete',
    turn_id: 'turn-1',
    last_agent_message: null,
    error: { message: 'failed', codex_error_info: codexErrorInfo },
  }).success;

describe('CodexErrorInfo', () => {
  it('accepts a bare variant or exactly one tagged data variant', () => {
    expect(taskComplete('server_overloaded')).toBe(true);
    expect(taskComplete({ http_connection_failed: { http_status_code: 502 } })).toBe(true);
    expect(taskComplete({ active_turn_not_steerable: { turn_kind: 'review' } })).toBe(true);
  });

  it('rejects an object that is not any tagged variant', () => {
    expect(taskComplete({})).toBe(false);
    expect(taskComplete({ http_conection_failed: { http_status_code: 502 } })).toBe(false);
  });
});

describe('buildCodexResponseItemSchema', () => {
  it('adds the extra shape to configuration_update too', () => {
    const schema = buildCodexResponseItemSchema({
      guardian_metadata: z.looseObject({ flag: z.boolean() }),
    });
    const update = { type: 'configuration_update', reasoning: {} };
    expect(schema.safeParse({ ...update, guardian_metadata: { flag: true } }).success).toBe(true);
    expect(schema.safeParse({ ...update, guardian_metadata: { flag: 'yes' } }).success).toBe(false);
  });
});
