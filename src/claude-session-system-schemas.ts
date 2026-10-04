import { z } from 'zod';

import { transcriptFields } from './claude-session-shared.js';

/**
 * `system` records: notices Claude Code writes into the conversation itself
 * (compaction boundaries, API retries, hook summaries, turn timing, local
 * command output). Discriminated on `subtype`.
 */

const level = z.enum(['info', 'warning', 'error', 'suggestion']);

/** Fields every system subtype shares on top of the transcript envelope. */
const systemFields = {
  ...transcriptFields,
  isMeta: z.boolean().optional(),
  level: level.optional(),
};

function systemRecord<Subtype extends string, Shape extends z.ZodRawShape>(
  subtype: Subtype,
  shape: Shape,
) {
  return z.looseObject({
    type: z.literal('system'),
    subtype: z.literal(subtype),
    ...systemFields,
    ...shape,
  });
}

const preservedSegment = z.looseObject({
  anchorUuid: z.string(),
  headUuid: z.string(),
  tailUuid: z.string(),
});

const compactMetadata = z.looseObject({
  trigger: z.enum(['manual', 'auto']),
  preTokens: z.number(),
  postTokens: z.number().optional(),
  durationMs: z.number().optional(),
  cumulativeDroppedTokens: z.number().optional(),
  preCompactDiscoveredTools: z.array(z.string()).optional(),
  preservedSegment: preservedSegment.optional(),
  preservedMessages: z
    .looseObject({
      anchorUuid: z.string(),
      uuids: z.array(z.string()),
      allUuids: z.array(z.string()),
    })
    .optional(),
});

const apiErrorDetail = z.looseObject({
  message: z.string(),
  formatted: z.string(),
  isNetworkDown: z.boolean(),
  status: z.number().optional(),
  // The failed connection's cause, when the request never got a response.
  connection: z
    .looseObject({ code: z.string(), isSSLError: z.boolean(), message: z.string() })
    .nullable()
    .optional(),
  noResponse: z.null().optional(),
  rateLimits: z.null().optional(),
});

const hookInfo = z.looseObject({
  command: z.string(),
  // Absent on hooks that never ran (a prompt hook that was skipped, a callback).
  durationMs: z.number().optional(),
  promptText: z.string().optional(),
});

/** Subtypes Claude Code 2.1.288 can write that no session on the checked machine contains. */
export const claudeSessionUnobservedSystemSubtypes = [
  'memory_saved',
  'model_consent_fallback',
  'model_fallback',
  'model_refusal_no_fallback',
  'per_turn_effort_changed',
  'permission_retry',
] as const;

/** Every `system` subtype schema, keyed by `subtype`. */
export const claudeSessionSystemRecordSchemas = {
  agents_killed: systemRecord('agents_killed', {}),
  api_error: systemRecord('api_error', {
    error: apiErrorDetail,
    maxRetries: z.number(),
    retryAttempt: z.number(),
    retryInMs: z.number(),
    source: z.enum(['request_retry']),
  }),
  away_summary: systemRecord('away_summary', { content: z.string() }),
  bridge_status: systemRecord('bridge_status', { content: z.string(), url: z.string() }),
  compact_boundary: systemRecord('compact_boundary', {
    content: z.string(),
    compactMetadata,
    logicalParentUuid: z.string().optional(),
  }),
  informational: systemRecord('informational', { content: z.string() }),
  local_command: systemRecord('local_command', {
    content: z.string(),
    commandRun: z.looseObject({ command: z.string(), args: z.string() }).optional(),
  }),
  model_refusal_fallback: systemRecord('model_refusal_fallback', {
    content: z.string(),
    apiRefusalCategory: z.enum(['bio', 'cyber']),
    apiRefusalExplanation: z.string().nullable(),
    direction: z.enum(['retry']),
    fallbackModel: z.string(),
    originalModel: z.string(),
    refusedUserMessageUuid: z.string(),
    requestId: z.string(),
    retractedMessageUuids: z.array(z.string()).optional(),
    scope: z.enum(['session']),
    trigger: z.enum(['refusal']),
  }),
  scheduled_task_fire: systemRecord('scheduled_task_fire', {
    content: z.string(),
    cron: z.string(),
    // `loop` for every recurring task on this machine; the binary does not enumerate others.
    cronKind: z.string(),
    taskKind: z.string(),
    taskId: z.string(),
    prompt: z.string(),
    foldedUuids: z.array(z.string()).optional(),
    noOpStreak: z.number().optional(),
    streakStartedAt: z.string().optional(),
  }),
  stop_hook_summary: systemRecord('stop_hook_summary', {
    hasOutput: z.boolean(),
    hookAdditionalContext: z.array(z.string()),
    hookCount: z.number(),
    hookErrors: z.array(z.string()),
    hookInfos: z.array(hookInfo),
    preventedContinuation: z.boolean(),
    stopReason: z.string(),
    toolUseID: z.string(),
  }),
  turn_duration: systemRecord('turn_duration', {
    durationMs: z.number(),
    messageCount: z.number(),
    pendingBackgroundAgentCount: z.number().optional(),
    pendingWorkflowCount: z.number().optional(),
  }),
};

/** A `system` record, discriminated on `subtype`. */
export const claudeSessionSystemRecordSchema = z.discriminatedUnion('subtype', [
  claudeSessionSystemRecordSchemas.agents_killed,
  claudeSessionSystemRecordSchemas.api_error,
  claudeSessionSystemRecordSchemas.away_summary,
  claudeSessionSystemRecordSchemas.bridge_status,
  claudeSessionSystemRecordSchemas.compact_boundary,
  claudeSessionSystemRecordSchemas.informational,
  claudeSessionSystemRecordSchemas.local_command,
  claudeSessionSystemRecordSchemas.model_refusal_fallback,
  claudeSessionSystemRecordSchemas.scheduled_task_fire,
  claudeSessionSystemRecordSchemas.stop_hook_summary,
  claudeSessionSystemRecordSchemas.turn_duration,
  z.looseObject({
    type: z.literal('system'),
    subtype: z.enum(claudeSessionUnobservedSystemSubtypes),
    ...systemFields,
  }),
]);
