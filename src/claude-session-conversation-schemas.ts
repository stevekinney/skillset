import { z } from 'zod';

import {
  claudeSessionAssistantMessageSchema,
  claudeSessionUserMessageSchema,
} from './claude-session-message-schemas.js';
import {
  claudeSessionApiErrors,
  claudeSessionEffortLevels,
  claudeSessionPermissionModes,
  claudeSessionToolDenialKinds,
  looseRecord,
  messageOrigin,
  transcriptRecord,
} from './claude-session-shared.js';
import { claudeSessionToolUseResultSchema } from './claude-session-tool-result-schemas.js';

/**
 * The two record types that carry the conversation itself: `user` (prompts,
 * tool results, queued and injected messages) and `assistant` (model output).
 */

/** The subscription rate-limit snapshot a throttled assistant record carries. */
const quotaLimits = z.looseObject({
  status: z.enum(['allowed', 'allowed_warning', 'rejected']),
  isUsingOverage: z.boolean().optional(),
  rateLimitType: z
    .enum([
      'five_hour',
      'seven_day',
      'seven_day_opus',
      'seven_day_sonnet',
      'seven_day_overage_included',
      'overage',
    ])
    .optional(),
  resetsAt: z.number().optional(),
  utilization: z.number().optional(),
  overageStatus: z.enum(['allowed', 'allowed_warning', 'rejected']).optional(),
  overageResetsAt: z.number().optional(),
  overageDisabledReason: z
    .enum([
      'overage_not_provisioned',
      'org_level_disabled',
      'org_level_disabled_until',
      'out_of_credits',
      'seat_tier_level_disabled',
      'member_level_disabled',
      'seat_tier_zero_credit_limit',
      'group_zero_credit_limit',
      'member_zero_credit_limit',
      'org_service_level_disabled',
      'no_limits_configured',
      'fetch_error',
      'unknown',
    ])
    .optional(),
  unifiedRateLimitFallbackAvailable: z.boolean().optional(),
  // Experiment arm and wait hints for low-priority queueing; the arm names are not enumerated.
  lowPriorityOffer: z.string().optional(),
  lowPriorityMaxWaitSeconds: z.number().optional(),
  lowPriorityRetryAfterSeconds: z.number().optional(),
});

/** An `assistant` record: one model response, or one streamed content block of it. */
export const claudeSessionAssistantRecordSchema = transcriptRecord('assistant', {
  message: claudeSessionAssistantMessageSchema,
  requestId: z.string().optional(),
  // Present on API-error placeholders Claude Code writes in place of a response.
  isApiErrorMessage: z.boolean().optional(),
  error: z.enum(claudeSessionApiErrors).optional(),
  apiError: z.enum(claudeSessionApiErrors).optional(),
  apiErrorIsTransient: z.boolean().optional(),
  apiErrorStatus: z.number().optional(),
  advisorModel: z.string().optional(),
  apiBlockIndex: z.number().optional(),
  attributionAgent: z.string().optional(),
  attributionMcpServer: z.string().optional(),
  attributionMcpTool: z.string().optional(),
  attributionSkill: z.string().optional(),
  effort: z.enum(claudeSessionEffortLevels).optional(),
  perTurnEffort: z.enum(claudeSessionEffortLevels).nullable().optional(),
  quotaLimits: quotaLimits.optional(),
  serverClassifierRequest: z.string().optional(),
  thinkingDurationMs: z.number().optional(),
  truncatedAfterOutput: z.boolean().optional(),
  // Keyed by `tool_use` id: the working directory the tool call was ingested under.
  wireIngestContext: z.record(z.string(), z.looseObject({ cwd: z.string() })).optional(),
  // Keyed by `tool_use` id: the input as sent over the wire, which differs from the stored
  // `tool_use.input` when Claude Code rewrote it. Each value is that tool's own input.
  wireToolInputs: looseRecord.optional(),
});

/** What `turnOrigin` says started a turn. */
const turnOrigins = ['human', 'task_notification', 'peer', 'scheduled', 'sdk'] as const;

/** A `user` record: a prompt, a tool result, or a message injected on the user's behalf. */
export const claudeSessionUserRecordSchema = transcriptRecord('user', {
  message: claudeSessionUserMessageSchema,
  promptId: z.string().optional(),
  permissionMode: z.enum(claudeSessionPermissionModes).optional(),
  promptSource: z.enum(['typed', 'queued', 'sdk', 'system', 'suggestion_accepted']).optional(),
  origin: messageOrigin.optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  isVisibleInTranscriptOnly: z.boolean().optional(),
  imagePasteIds: z.array(z.number()).optional(),
  interruptedByShutdown: z.boolean().optional(),
  interruptedMessageId: z.string().optional(),
  queuePriority: z.enum(['now', 'next', 'later']).optional(),
  queueSkipAttachments: z.boolean().optional(),
  queueTranscriptOnly: z.boolean().optional(),
  scheduledFireId: z.string().optional(),
  scheduledTaskId: z.string().optional(),
  sourceToolAssistantUUID: z.string().optional(),
  sourceToolUseID: z.string().optional(),
  toolDenialKind: z.enum(claudeSessionToolDenialKinds).optional(),
  toolEndsTurn: z.boolean().optional(),
  toolUseResult: claudeSessionToolUseResultSchema.optional(),
  turnCompanion: z.boolean().optional(),
  turnOrigin: z.enum(turnOrigins).optional(),
  turnPosition: z.looseObject({ promptIndex: z.number(), turnIndex: z.number() }).optional(),
  // The auto-mode classifier's input (git state, cwd, the request under review). Internal to
  // Claude Code and reshaped between versions, so only the `request` text is named.
  classifierMetaLines: z.string().optional(),
  classifierBoundary: z.boolean().optional(),
  hostClassifierContext: z.string().optional(),
  serverClassifierContext: z.looseObject({ request: z.string(), context: looseRecord }).optional(),
  // The MCP result's `_meta` and `structuredContent`: defined by each MCP server, not Claude Code.
  mcpMeta: looseRecord.optional(),
});

export type ClaudeSessionAssistantRecord = z.infer<typeof claudeSessionAssistantRecordSchema>;

export type ClaudeSessionUserRecord = z.infer<typeof claudeSessionUserRecordSchema>;
