import { z } from 'zod';

import {
  claudeSessionAgentColors,
  claudeSessionPermissionModes,
  looseRecord,
  sessionRecord,
} from './claude-session-shared.js';

/**
 * The session-state and bookkeeping records: titles, modes, latches, links,
 * cost and file-history. None of them carries the conversation-chain fields
 * (`uuid`, `parentUuid`, `cwd`, ...); most name only their `sessionId`.
 *
 * Records marked "binary only" are written by Claude Code 2.1.288 (shape
 * taken from its record-writing code) but appear in none of the sessions on
 * the machine this schema was checked against. Their fields are optional
 * wherever the writer code does not make them unconditional.
 */

const sessionId = { sessionId: z.string() };

const fileBackup = z.looseObject({
  // `null` when the tracked file did not exist at backup time.
  backupFileName: z.string().nullable(),
  version: z.number(),
  backupTime: z.string(),
  realParentDir: z.string().optional(),
});

/** Token and cost totals for one model inside a `cost-state` record. */
const modelUsage = z.looseObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
  thinkingTokens: z.number().optional(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  webSearchRequests: z.number(),
  costUSD: z.number(),
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  canonicalModel: z.string().optional(),
});

const worktreeSession = z.looseObject({
  originalBranch: z.string().optional(),
  originalCwd: z.string(),
  originalHeadCommit: z.string().optional(),
  preEnterOriginalCwd: z.string().optional(),
  worktreeBranch: z.string().optional(),
  worktreeName: z.string(),
  worktreePath: z.string(),
  sessionId: z.string().optional(),
});

const queueOperationReasons = ['absorbed_mid_turn', 'delivered_to_agent'] as const;

/** Records that carry the session id, a title, a mode or a link. */
export const claudeSessionStateRecordSchemas = {
  'agent-name': sessionRecord('agent-name', { ...sessionId, agentName: z.string() }),
  'agent-setting': sessionRecord('agent-setting', { ...sessionId, agentSetting: z.string() }),
  'ai-title': sessionRecord('ai-title', { ...sessionId, aiTitle: z.string() }),
  'custom-title': sessionRecord('custom-title', { ...sessionId, customTitle: z.string() }),
  'last-prompt': sessionRecord('last-prompt', {
    ...sessionId,
    // Absent when the last turn had no typed prompt.
    lastPrompt: z.string().optional(),
    leafUuid: z.string(),
  }),
  mode: sessionRecord('mode', { ...sessionId, mode: z.enum(['normal', 'coordinator']) }),
  'permission-mode': sessionRecord('permission-mode', {
    ...sessionId,
    permissionMode: z.enum(claudeSessionPermissionModes),
  }),
  'pr-link': sessionRecord('pr-link', {
    ...sessionId,
    prNumber: z.number(),
    prRepository: z.string(),
    prUrl: z.string(),
    timestamp: z.string(),
  }),
  relocated: sessionRecord('relocated', { ...sessionId, relocatedCwd: z.string() }),
  'worktree-state': sessionRecord('worktree-state', {
    ...sessionId,
    // `null` after the session leaves its worktree.
    worktreeSession: worktreeSession.nullable(),
  }),
  'atis-latch': sessionRecord('atis-latch', { ...sessionId, atis: z.string() }),
  'bridge-session': sessionRecord('bridge-session', {
    ...sessionId,
    bridgeSessionId: z.string(),
    lastSequenceNum: z.number(),
    ownerAccountUuid: z.string().optional(),
    ownerOrganizationUuid: z.string().optional(),
  }),
  'cost-state': sessionRecord('cost-state', {
    ...sessionId,
    hasUnknownModelCost: z.boolean(),
    // Keyed by model name.
    modelUsage: z.record(z.string(), modelUsage),
    startTime: z.number(),
    totalAPIDuration: z.number(),
    totalAPIDurationWithoutRetries: z.number(),
    totalCostUSD: z.number(),
    totalDuration: z.number(),
    totalLinesAdded: z.number(),
    totalLinesRemoved: z.number(),
    totalToolDuration: z.number(),
  }),
  'queue-operation': sessionRecord('queue-operation', {
    ...sessionId,
    operation: z.enum(['enqueue', 'dequeue', 'remove', 'popAll']),
    timestamp: z.string(),
    content: z.string().optional(),
    commandUuid: z.string().optional(),
    deliveryId: z.string().optional(),
    reason: z.enum(queueOperationReasons).optional(),
  }),
  'file-history-snapshot': sessionRecord('file-history-snapshot', {
    messageId: z.string(),
    isSnapshotUpdate: z.boolean(),
    snapshot: z.looseObject({
      messageId: z.string(),
      timestamp: z.string(),
      // Keyed by the tracked file's path relative to the working directory.
      trackedFileBackups: z.record(z.string(), fileBackup),
    }),
  }),
  'file-history-delta': sessionRecord('file-history-delta', {
    messageId: z.string(),
    snapshotMessageId: z.string(),
    timestamp: z.string(),
    trackingPath: z.string(),
    backup: fileBackup,
  }),
  // Binary only from here down.
  tag: sessionRecord('tag', { ...sessionId, tag: z.string() }),
  'agent-color': sessionRecord('agent-color', {
    ...sessionId,
    agentColor: z.enum(claudeSessionAgentColors),
  }),
  // Written by pre-2.0 versions as a conversation summary pointing at its leaf message.
  summary: sessionRecord('summary', { summary: z.string(), leafUuid: z.string() }),
  'continued-in': sessionRecord('continued-in', {
    ...sessionId,
    timestamp: z.string(),
    continuedInSessionId: z.string(),
  }),
  'ended-by-model': sessionRecord('ended-by-model', { ...sessionId, timestamp: z.string() }),
  'isolation-latch': sessionRecord('isolation-latch', { ...sessionId, side: z.string() }),
  'dev-mods': sessionRecord('dev-mods', { ...sessionId, folder: z.string() }),
  'memory-mode': sessionRecord('memory-mode', {
    ...sessionId,
    mode: z.string(),
    afterUuid: z.string().optional(),
    timestamp: z.string(),
    reason: z.string().optional(),
    account: z.string().optional(),
    accountChoice: z.string().optional(),
  }),
  'history-suppression': sessionRecord('history-suppression', {
    ...sessionId,
    cause: z.string(),
    vetoedAgainstAccountUuid: z.string().optional(),
    ts: z.string(),
  }),
  'frame-link': sessionRecord('frame-link', {
    ...sessionId,
    path: z.string().optional(),
    frameUrl: z.string().optional(),
    title: z.string().optional(),
    artifactCount: z.number(),
    timestamp: z.string(),
  }),
  'attribution-snapshot': sessionRecord('attribution-snapshot', {
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
  }),
  'observer-ref': sessionRecord('observer-ref', {
    sessionId: z.string().optional(),
    timestamp: z.string(),
  }),
  'fork-context-ref': sessionRecord('fork-context-ref', {
    sessionId: z.string().optional(),
    agentId: z.string(),
  }),
  'content-replacement': sessionRecord('content-replacement', {
    ...sessionId,
    agentId: z.string().optional(),
    replacements: z.array(looseRecord),
  }),
  'api-request-shape': sessionRecord('api-request-shape', {
    ...sessionId,
    agentId: z.string().optional(),
    shapeHash: z.string(),
    timestamp: z.string(),
    version: z.union([z.string(), z.number()]),
    shape: z.unknown(),
  }),
  'api-request-blob': sessionRecord('api-request-blob', {
    ...sessionId,
    agentId: z.string().optional(),
    hash: z.string(),
    message: z.unknown(),
  }),
  'api-request': sessionRecord('api-request', {
    ...sessionId,
    agentId: z.string().optional(),
    id: z.string(),
    timestamp: z.string(),
    version: z.union([z.string(), z.number()]),
    querySource: z.string().optional(),
    shapeHash: z.string().optional(),
    params: z.unknown(),
  }),
  'artifact-comment-monitor': sessionRecord('artifact-comment-monitor', {
    ...sessionId,
    v: z.number(),
    artifacts: z.unknown(),
  }),
  'artifact-autoreact-ledger': sessionRecord('artifact-autoreact-ledger', {
    ...sessionId,
    v: z.number(),
    accountUuid: z.string().optional(),
    artifacts: z.unknown(),
  }),
};
