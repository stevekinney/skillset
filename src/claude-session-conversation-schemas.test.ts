import { describe, expect, it } from 'bun:test';

import {
  claudeSessionAssistantRecordSchema,
  claudeSessionUserRecordSchema,
} from './claude-session-conversation-schemas.js';

const chain = {
  uuid: 'u-1',
  parentUuid: null,
  sessionId: 's-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  isSidechain: false,
  userType: 'external',
  cwd: '/work',
  version: '2.1.288',
};
const assistantMessage = {
  role: 'assistant',
  model: 'a-model',
  content: [{ type: 'text', text: 'hi' }],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
};

const parsesUser = (patch: Record<string, unknown>) =>
  claudeSessionUserRecordSchema.safeParse({
    type: 'user',
    ...chain,
    message: { role: 'user', content: 'x' },
    ...patch,
  }).success;
const parsesAssistant = (patch: Record<string, unknown>) =>
  claudeSessionAssistantRecordSchema.safeParse({
    type: 'assistant',
    ...chain,
    message: assistantMessage,
    ...patch,
  }).success;

describe('user records', () => {
  const origins: Record<string, Record<string, unknown>> = {
    human: {},
    channel: { server: 'srv' },
    peer: {
      from: 'uds:/tmp/a.sock',
      fromMode: 'prompting',
      name: 'n',
      fromSession: 'local_1',
      inbound_origin: 'o',
      senderTaskId: 't',
      body: 'b',
      verifiedPeerPid: 12,
      handback: true,
      hopChain: ['h'],
      msg_id: 'm',
    },
    'task-notification': {
      subkind: 'scheduled-trigger',
      fireReason: 'manual',
      producer: 'session-task',
    },
    coordinator: {},
    unclassified: {},
    observer: { from: 'f', senderTaskId: 't' },
    'auto-continuation': {},
    'observer-activity': {},
    'slack-ping': {},
  };

  for (const [kind, fields] of Object.entries(origins)) {
    it(`parses a user record with a ${kind} origin`, () => {
      expect(parsesUser({ origin: { kind, ...fields } })).toBe(true);
    });
  }

  it('parses a user record with every optional field', () => {
    expect(
      parsesUser({
        promptId: 'p',
        permissionMode: 'auto',
        promptSource: 'typed',
        isMeta: true,
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        imagePasteIds: [1],
        interruptedByShutdown: true,
        interruptedMessageId: 'msg_1',
        queuePriority: 'later',
        queueSkipAttachments: true,
        queueTranscriptOnly: true,
        scheduledFireId: 'f',
        scheduledTaskId: 't',
        sourceToolAssistantUUID: 'u-0',
        sourceToolUseID: 't-1',
        toolDenialKind: 'permission-rule',
        toolEndsTurn: true,
        toolUseResult: 'denied',
        turnCompanion: true,
        turnOrigin: 'task_notification',
        turnPosition: { promptIndex: 0, turnIndex: 1 },
        classifierMetaLines: '{}',
        classifierBoundary: true,
        hostClassifierContext: 'ctx',
        serverClassifierContext: { request: 'r', context: { live_cwd: '/work' } },
        mcpMeta: { _meta: {} },
        agentId: 'a-1',
        agentName: 'n',
        teamName: 't',
        slug: 'a-b-c',
        session_id: 's-1',
      }),
    ).toBe(true);
  });

  it('rejects an out-of-set origin kind, tool denial kind, prompt source and turn origin', () => {
    expect(parsesUser({ origin: { kind: 'alien' } })).toBe(false);
    expect(parsesUser({ toolDenialKind: 'shrugged' })).toBe(false);
    expect(parsesUser({ promptSource: 'telepathy' })).toBe(false);
    expect(parsesUser({ turnOrigin: 'dream' })).toBe(false);
  });
});

describe('assistant records', () => {
  it('parses an assistant record with every optional field', () => {
    expect(
      parsesAssistant({
        requestId: 'req_1',
        isApiErrorMessage: true,
        error: 'rate_limit',
        apiError: 'max_output_tokens',
        apiErrorIsTransient: true,
        apiErrorStatus: 429,
        advisorModel: 'm',
        apiBlockIndex: 0,
        attributionAgent: 'general-purpose',
        attributionMcpServer: 'srv',
        attributionMcpTool: 'tool',
        attributionSkill: 'chef',
        effort: 'xhigh',
        perTurnEffort: null,
        quotaLimits: {
          status: 'rejected',
          isUsingOverage: false,
          rateLimitType: 'five_hour',
          resetsAt: 1,
          utilization: 1,
          overageStatus: 'rejected',
          overageResetsAt: 2,
          overageDisabledReason: 'org_level_disabled',
          unifiedRateLimitFallbackAvailable: false,
          lowPriorityOffer: 'control',
          lowPriorityMaxWaitSeconds: 1,
          lowPriorityRetryAfterSeconds: 1,
        },
        serverClassifierRequest: 'r',
        thinkingDurationMs: 5,
        truncatedAfterOutput: true,
        wireIngestContext: { 't-1': { cwd: '/work' } },
        wireToolInputs: { 't-1': { command: 'ls' } },
      }),
    ).toBe(true);
  });

  it('rejects an out-of-set effort, API error and quota status', () => {
    expect(parsesAssistant({ effort: 'extreme' })).toBe(false);
    expect(parsesAssistant({ error: 'gremlins' })).toBe(false);
    expect(parsesAssistant({ quotaLimits: { status: 'vibes' } })).toBe(false);
  });
});
