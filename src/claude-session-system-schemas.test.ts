import { describe, expect, it } from 'bun:test';

import {
  claudeSessionSystemRecordSchema,
  claudeSessionSystemRecordSchemas,
  claudeSessionUnobservedSystemSubtypes,
} from './claude-session-system-schemas.js';

const chain = {
  type: 'system',
  uuid: 'u-1',
  parentUuid: 'u-0',
  sessionId: 's-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  isSidechain: false,
  userType: 'external',
  cwd: '/work',
  version: '2.1.288',
};

const fixtures: Record<keyof typeof claudeSessionSystemRecordSchemas, Record<string, unknown>> = {
  agents_killed: { isMeta: false },
  api_error: {
    level: 'error',
    source: 'request_retry',
    maxRetries: 10,
    retryAttempt: 1,
    retryInMs: 500,
    error: {
      message: 'Connection error.',
      formatted: 'Connection error.',
      isNetworkDown: true,
      connection: { code: 'ENOTFOUND', isSSLError: false, message: 'lookup failed' },
      noResponse: null,
      rateLimits: null,
    },
  },
  away_summary: { content: 'Summary', isMeta: false },
  bridge_status: { content: 'Connected', url: 'https://example.test/bridge' },
  compact_boundary: {
    content: 'Conversation compacted',
    level: 'info',
    logicalParentUuid: 'u-0',
    compactMetadata: {
      trigger: 'auto',
      preTokens: 100,
      postTokens: 10,
      durationMs: 50,
      cumulativeDroppedTokens: 90,
      preCompactDiscoveredTools: ['Bash'],
      preservedSegment: { anchorUuid: 'a', headUuid: 'h', tailUuid: 't' },
      preservedMessages: { anchorUuid: 'a', uuids: ['x'], allUuids: ['x', 'y'] },
    },
  },
  informational: { content: 'Heads up', level: 'warning' },
  local_command: {
    content: '<local-command-stdout></local-command-stdout>',
    level: 'info',
    commandRun: { command: 'clear', args: '' },
  },
  model_refusal_fallback: {
    content: 'Retrying on another model',
    level: 'warning',
    apiRefusalCategory: 'cyber',
    apiRefusalExplanation: null,
    direction: 'retry',
    fallbackModel: 'fallback-model',
    originalModel: 'original-model',
    refusedUserMessageUuid: 'u-9',
    requestId: 'req-1',
    retractedMessageUuids: ['u-8'],
    scope: 'session',
    trigger: 'refusal',
  },
  scheduled_task_fire: {
    content: 'Fired',
    cron: '*/5 * * * *',
    cronKind: 'loop',
    taskKind: 'loop',
    taskId: 'task-1',
    prompt: '/loop',
    foldedUuids: ['u-7'],
    noOpStreak: 2,
    streakStartedAt: '2026-01-01T00:00:00.000Z',
  },
  stop_hook_summary: {
    level: 'suggestion',
    hasOutput: false,
    hookAdditionalContext: [],
    hookCount: 2,
    hookErrors: [],
    hookInfos: [{ command: 'callback' }, { command: 'run.sh', durationMs: 12, promptText: 'p' }],
    preventedContinuation: false,
    stopReason: '',
    toolUseID: 't-1',
  },
  turn_duration: {
    durationMs: 5,
    messageCount: 2,
    pendingBackgroundAgentCount: 1,
    pendingWorkflowCount: 0,
  },
};

describe('claudeSessionSystemRecordSchema', () => {
  for (const [subtype, fixture] of Object.entries(fixtures)) {
    it(`parses a ${subtype} record`, () => {
      const record = { ...chain, subtype, ...fixture };
      expect(claudeSessionSystemRecordSchema.safeParse(record).success).toBe(true);
    });
  }

  it('has a fixture for every modelled subtype', () => {
    expect(Object.keys(fixtures).toSorted()).toEqual(
      Object.keys(claudeSessionSystemRecordSchemas).toSorted(),
    );
  });

  for (const subtype of claudeSessionUnobservedSystemSubtypes) {
    it(`accepts the ${subtype} subtype by its tag alone`, () => {
      expect(claudeSessionSystemRecordSchema.safeParse({ ...chain, subtype }).success).toBe(true);
    });
  }

  it('rejects a subtype it does not know and a missing field', () => {
    expect(claudeSessionSystemRecordSchema.safeParse({ ...chain, subtype: 'later' }).success).toBe(
      false,
    );
    expect(
      claudeSessionSystemRecordSchema.safeParse({ ...chain, subtype: 'turn_duration' }).success,
    ).toBe(false);
  });

  it('keeps unknown fields', () => {
    const parsed = claudeSessionSystemRecordSchema.parse({
      ...chain,
      subtype: 'agents_killed',
      later: 1,
    });
    expect(parsed).toMatchObject({ later: 1 });
  });
});
