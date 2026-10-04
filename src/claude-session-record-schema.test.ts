import { describe, expect, it } from 'bun:test';

import {
  claudeSessionRecordSchema,
  claudeSessionRecordSchemas,
  claudeSessionRecordTypeNames,
  parseClaudeSessionRecord,
  safeParseClaudeSessionRecord,
  type ClaudeSessionRecord,
  type ClaudeSessionRecordFor,
} from './claude-session-record-schema.js';

const chain = {
  uuid: 'u-1',
  parentUuid: null,
  sessionId: 's-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  isSidechain: false,
  userType: 'external',
  cwd: '/work',
  version: '2.1.288',
  entrypoint: 'cli',
  gitBranch: 'main',
};
const sessionId = 's-1';
const usage = {
  input_tokens: 1,
  output_tokens: 2,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
const backup = { backupFileName: null, version: 1, backupTime: '2026-01-01T00:00:00.000Z' };

/** One hand-written record per type that is not `system` or `attachment` (those have their own tests). */
const fixtures: Record<string, Record<string, unknown>> = {
  user: { ...chain, message: { role: 'user', content: 'hello' } },
  assistant: {
    ...chain,
    message: {
      role: 'assistant',
      model: 'a-model',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      usage,
    },
  },
  system: { ...chain, subtype: 'turn_duration', durationMs: 5, messageCount: 2 },
  attachment: { ...chain, attachment: { type: 'date', date: '2026-01-01' } },
  progress: { data: { type: 'hook_progress' }, toolUseID: 't-1' },
  'agent-name': { sessionId, agentName: 'planner' },
  'agent-setting': { sessionId, agentSetting: 'general-purpose' },
  'ai-title': { sessionId, aiTitle: 'A title' },
  'custom-title': { sessionId, customTitle: 'Mine' },
  'last-prompt': { sessionId, leafUuid: 'u-1' },
  mode: { sessionId, mode: 'normal' },
  'permission-mode': { sessionId, permissionMode: 'plan' },
  'pr-link': {
    sessionId,
    prNumber: 3,
    prRepository: 'owner/repo',
    prUrl: 'https://example.test/pull/3',
    timestamp: '2026-01-01T00:00:00.000Z',
  },
  relocated: { sessionId, relocatedCwd: '/elsewhere' },
  'worktree-state': { sessionId, worktreeSession: null },
  'atis-latch': { sessionId, atis: '' },
  'bridge-session': { sessionId, bridgeSessionId: 'b-1', lastSequenceNum: 4 },
  'cost-state': {
    sessionId,
    hasUnknownModelCost: false,
    modelUsage: {
      'a-model': {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
        webSearchRequests: 0,
        costUSD: 0.5,
      },
    },
    startTime: 1,
    totalAPIDuration: 2,
    totalAPIDurationWithoutRetries: 2,
    totalCostUSD: 0.5,
    totalDuration: 3,
    totalLinesAdded: 4,
    totalLinesRemoved: 5,
    totalToolDuration: 6,
  },
  'queue-operation': {
    sessionId,
    operation: 'enqueue',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: 'queued',
  },
  'file-history-snapshot': {
    messageId: 'm-1',
    isSnapshotUpdate: false,
    snapshot: {
      messageId: 'm-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      trackedFileBackups: { 'a.ts': backup },
    },
  },
  'file-history-delta': {
    messageId: 'm-1',
    snapshotMessageId: 'm-0',
    timestamp: '2026-01-01T00:00:00.000Z',
    trackingPath: 'a.ts',
    backup,
  },
  tag: { sessionId, tag: 'wip' },
  'agent-color': { sessionId, agentColor: 'cyan' },
  summary: { summary: 'Earlier work', leafUuid: 'u-1' },
  'continued-in': {
    sessionId,
    timestamp: '2026-01-01T00:00:00.000Z',
    continuedInSessionId: 's-2',
  },
  'ended-by-model': { sessionId, timestamp: '2026-01-01T00:00:00.000Z' },
  'isolation-latch': { sessionId, side: 'left' },
  'dev-mods': { sessionId, folder: '/mods' },
  'memory-mode': { sessionId, mode: 'on', timestamp: '2026-01-01T00:00:00.000Z' },
  'history-suppression': { sessionId, cause: 'migration', ts: '2026-01-01T00:00:00.000Z' },
  'frame-link': { sessionId, artifactCount: 1, timestamp: '2026-01-01T00:00:00.000Z' },
  'attribution-snapshot': { messageId: 'm-1' },
  'observer-ref': { timestamp: '2026-01-01T00:00:00.000Z' },
  'fork-context-ref': { agentId: 'a-1' },
  'content-replacement': { sessionId, replacements: [{ kind: 'x' }] },
  'api-request-shape': { sessionId, shapeHash: 'h', timestamp: 't', version: 1, shape: {} },
  'api-request-blob': { sessionId, hash: 'h', message: {} },
  'api-request': { sessionId, id: 'r-1', timestamp: 't', version: 1, params: {} },
  'artifact-comment-monitor': { sessionId, v: 1, artifacts: [] },
  'artifact-autoreact-ledger': { sessionId, v: 1, artifacts: [] },
};

describe('claudeSessionRecordSchemas', () => {
  it('has a fixture for every record type, and no fixture for a type that does not exist', () => {
    expect(Object.keys(fixtures).toSorted()).toEqual([...claudeSessionRecordTypeNames].toSorted());
  });

  it('lists exactly the keys of the schema map', () => {
    const names: string[] = [...claudeSessionRecordTypeNames];
    expect(names).toEqual(Object.keys(claudeSessionRecordSchemas));
    expect(claudeSessionRecordTypeNames).toHaveLength(40);
  });

  for (const type of claudeSessionRecordTypeNames) {
    it(`parses a ${type} record through both the union and its own schema`, () => {
      const fixture = { type, ...fixtures[type] };
      expect(claudeSessionRecordSchema.safeParse(fixture).success).toBe(true);
      expect(claudeSessionRecordSchemas[type].safeParse(fixture).success).toBe(true);
      expect(parseClaudeSessionRecord(fixture)).toMatchObject({ type });
    });
  }

  it('keeps fields a newer version adds', () => {
    const parsed = parseClaudeSessionRecord({
      type: 'ai-title',
      sessionId,
      aiTitle: 'T',
      addedLater: { nested: true },
    });
    expect(parsed).toMatchObject({ addedLater: { nested: true } });
  });

  it('narrows by type', () => {
    const record: ClaudeSessionRecord = parseClaudeSessionRecord({
      type: 'permission-mode',
      sessionId,
      permissionMode: 'dontAsk',
    });
    if (record.type === 'permission-mode') expect(record.permissionMode).toBe('dontAsk');
    const typed: ClaudeSessionRecordFor<'mode'> = { type: 'mode', sessionId, mode: 'coordinator' };
    expect(claudeSessionRecordSchemas.mode.parse(typed).mode).toBe('coordinator');
  });
});

describe('parseClaudeSessionRecord and safeParseClaudeSessionRecord', () => {
  it('reports the exact path of a bad field in a known type', () => {
    const result = safeParseClaudeSessionRecord({
      type: 'user',
      ...chain,
      message: { role: 'assistant', content: 'x' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['message', 'role']);
  });

  it('rejects a type it does not know', () => {
    expect(safeParseClaudeSessionRecord({ type: 'from-the-future', sessionId }).success).toBe(
      false,
    );
  });

  it('rejects a value that is not an object', () => {
    expect(safeParseClaudeSessionRecord(null).success).toBe(false);
    expect(safeParseClaudeSessionRecord('line').success).toBe(false);
    expect(safeParseClaudeSessionRecord({ type: 7 }).success).toBe(false);
  });

  it('does not treat an inherited property as a record type', () => {
    expect(safeParseClaudeSessionRecord({ type: 'toString' }).success).toBe(false);
  });

  it('throws a ZodError from the throwing variant', () => {
    expect(() => parseClaudeSessionRecord({ type: 'mode' })).toThrow();
  });

  it('rejects an out-of-set permission mode and entrypoint', () => {
    expect(
      safeParseClaudeSessionRecord({ type: 'permission-mode', sessionId, permissionMode: 'yolo' })
        .success,
    ).toBe(false);
    expect(
      safeParseClaudeSessionRecord({ type: 'user', ...chain, entrypoint: 'toaster', message: {} })
        .success,
    ).toBe(false);
  });
});
