import { z } from 'zod';

import {
  activePermissionProfileSchema,
  approvalPolicySchema,
  approvalsReviewerSchema,
  collaborationModeSchema,
  modeKindSchema,
  permissionProfileSchema,
  personalitySchema,
  planTypeSchema,
  reasoningEffortSchema,
  reasoningSummarySchema,
  tokenUsageSchema,
} from './codex-session-shared.js';
import { turnItemSchema } from './codex-session-turn-items.js';

/**
 * `EventMsg`: the `event_msg` records, discriminated on `payload.type`.
 *
 * Sources: `EventMsg` in `codex-rs/protocol/src/protocol.rs` and the persisted
 * set in `codex-rs/rollout/src/policy.rs` at `rust-v0.160.0`. Codex persists
 * only some events: seven are verified against real data (`item_completed`,
 * `task_started`, `task_complete`, `token_count`, `turn_aborted`,
 * `thread_goal_updated`, `thread_settings_applied`) and `thread_rolled_back` is
 * modeled from source, unverified by data.
 *
 * The rest of `EventMsg` is written only by rollouts whose `history_mode` is
 * `legacy` (Codex 0.160 writes `paginated` ones, and so does every rollout on
 * the author's machine). They are named in `codexEventMessageSchemas` and
 * accepted as `{ type }` with every other key left loose, because there is no
 * data to verify a full model against.
 */

/** A legacy-history event: only `type` is modeled, see the module comment. */
function legacyEvent<Type extends string>(type: Type) {
  return z.looseObject({ type: z.literal(type) });
}

/** `CodexErrorInfo`: a bare string for unit variants, a one-key object for the data variants. */
const codexErrorInfoSchema = z.union([
  z.enum([
    'context_window_exceeded',
    'session_budget_exceeded',
    'usage_limit_exceeded',
    'rate_limit_exceeded',
    'flex_unavailable',
    'server_overloaded',
    'cyber_policy',
    'bio_policy',
    'misalignment_policy_violation',
    'too_many_denials',
    'internal_server_error',
    'unauthorized',
    'bad_request',
    'invalid_prompt',
    'sandbox_error',
    'thread_rollback_failed',
    'other',
  ]),
  z.looseObject({
    http_connection_failed: z.looseObject({ http_status_code: z.number().nullable() }).optional(),
    response_stream_connection_failed: z
      .looseObject({ http_status_code: z.number().nullable() })
      .optional(),
    response_stream_disconnected: z
      .looseObject({ http_status_code: z.number().nullable() })
      .optional(),
    response_too_many_failed_attempts: z
      .looseObject({ http_status_code: z.number().nullable() })
      .optional(),
    active_turn_not_steerable: z
      .looseObject({ turn_kind: z.enum(['review', 'compact']) })
      .optional(),
  }),
]);

const rateLimitWindowSchema = z.looseObject({
  used_percent: z.number(),
  window_minutes: z.number().nullable(),
  resets_at: z.number().nullable(),
});

const rateLimitsSchema = z.looseObject({
  limit_id: z.string().nullable(),
  limit_name: z.string().nullable(),
  normal_model_slug: z.string().optional(),
  primary: rateLimitWindowSchema.nullable(),
  secondary: rateLimitWindowSchema.nullable(),
  credits: z
    .looseObject({
      has_credits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullable(),
    })
    .nullable(),
  individual_limit: z
    .looseObject({
      limit: z.string(),
      used: z.string(),
      remaining_percent: z.number(),
      resets_at: z.number(),
    })
    .nullable(),
  spend_control_reached: z.boolean().nullable(),
  plan_type: planTypeSchema.nullable(),
  rate_limit_reached_type: z
    .enum([
      'rate_limit_reached',
      'workspace_owner_credits_depleted',
      'workspace_member_credits_depleted',
      'workspace_owner_usage_limit_reached',
      'workspace_member_usage_limit_reached',
    ])
    .nullable(),
});

const threadSettingsSchema = z.looseObject({
  model: z.string(),
  model_provider_id: z.string(),
  service_tier: z.string().optional(),
  approval_policy: approvalPolicySchema,
  approvals_reviewer: approvalsReviewerSchema,
  permission_profile: permissionProfileSchema,
  active_permission_profile: activePermissionProfileSchema.optional(),
  cwd: z.string(),
  runtime_workspace_roots: z.array(z.string()).optional(),
  reasoning_effort: reasoningEffortSchema.nullable().optional(),
  reasoning_summary: reasoningSummarySchema.nullable().optional(),
  personality: personalitySchema.nullable().optional(),
  collaboration_mode: collaborationModeSchema,
  disabled_plugin_ids: z.array(z.string()).optional(),
});

const timing = {
  started_at: z.number().nullable().optional(),
  completed_at: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
};

/** Per-type payload schemas for `event_msg`, keyed by `payload.type`. */
export const codexEventMessageSchemas = {
  item_completed: z.looseObject({
    type: z.literal('item_completed'),
    thread_id: z.string(),
    turn_id: z.string(),
    item: turnItemSchema,
    started_at_ms: z.number().optional(),
    completed_at_ms: z.number(),
  }),
  task_started: z.looseObject({
    type: z.literal('task_started'),
    turn_id: z.string(),
    root_turn_id: z.string().optional(),
    trace_id: z.string().optional(),
    started_at: z.number().nullable().optional(),
    model_context_window: z.number().nullable(),
    collaboration_mode_kind: modeKindSchema.optional(),
  }),
  task_complete: z.looseObject({
    type: z.literal('task_complete'),
    turn_id: z.string(),
    last_agent_message: z.string().nullable(),
    error: z
      .looseObject({
        message: z.string(),
        codex_error_info: codexErrorInfoSchema.nullable().optional(),
      })
      .optional(),
    time_to_first_token_ms: z.number().nullable().optional(),
    ...timing,
  }),
  token_count: z.looseObject({
    type: z.literal('token_count'),
    info: z
      .looseObject({
        total_token_usage: tokenUsageSchema,
        last_token_usage: tokenUsageSchema,
        model_context_window: z.number().nullable().optional(),
      })
      .nullable(),
    rate_limits: rateLimitsSchema.nullable(),
  }),
  turn_aborted: z.looseObject({
    type: z.literal('turn_aborted'),
    turn_id: z.string().nullable().optional(),
    reason: z.enum(['interrupted', 'replaced', 'review_ended', 'budget_limited']),
    error: z.looseObject({ message: z.string() }).optional(),
    ...timing,
  }),
  thread_goal_updated: z.looseObject({
    type: z.literal('thread_goal_updated'),
    threadId: z.string(),
    turnId: z.string().optional(),
    goal: z.looseObject({
      threadId: z.string(),
      objective: z.string(),
      status: z.enum(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']),
      tokenBudget: z.number().optional(),
      tokensUsed: z.number(),
      timeUsedSeconds: z.number(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  }),
  thread_settings_applied: z.looseObject({
    type: z.literal('thread_settings_applied'),
    thread_id: z.string().optional(),
    thread_settings: threadSettingsSchema,
  }),
  thread_rolled_back: z.looseObject({
    type: z.literal('thread_rolled_back'),
    num_turns: z.number(),
  }),
  user_message: legacyEvent('user_message'),
  agent_message: legacyEvent('agent_message'),
  agent_reasoning: legacyEvent('agent_reasoning'),
  agent_reasoning_raw_content: legacyEvent('agent_reasoning_raw_content'),
  entered_review_mode: legacyEvent('entered_review_mode'),
  exited_review_mode: legacyEvent('exited_review_mode'),
  patch_apply_end: legacyEvent('patch_apply_end'),
  context_compacted: legacyEvent('context_compacted'),
  mcp_tool_call_end: legacyEvent('mcp_tool_call_end'),
  web_search_end: legacyEvent('web_search_end'),
  image_generation_end: legacyEvent('image_generation_end'),
  sub_agent_activity: legacyEvent('sub_agent_activity'),
} as const;

/** Every `payload.type` an `event_msg` record can carry. */
export const codexEventMessageTypes = [
  'item_completed',
  'task_started',
  'task_complete',
  'token_count',
  'turn_aborted',
  'thread_goal_updated',
  'thread_settings_applied',
  'thread_rolled_back',
  'user_message',
  'agent_message',
  'agent_reasoning',
  'agent_reasoning_raw_content',
  'entered_review_mode',
  'exited_review_mode',
  'patch_apply_end',
  'context_compacted',
  'mcp_tool_call_end',
  'web_search_end',
  'image_generation_end',
  'sub_agent_activity',
] as const satisfies readonly (keyof typeof codexEventMessageSchemas)[];

const schemas = codexEventMessageSchemas;

export const codexEventMessageSchema = z.discriminatedUnion('type', [
  schemas.item_completed,
  schemas.task_started,
  schemas.task_complete,
  schemas.token_count,
  schemas.turn_aborted,
  schemas.thread_goal_updated,
  schemas.thread_settings_applied,
  schemas.thread_rolled_back,
  schemas.user_message,
  schemas.agent_message,
  schemas.agent_reasoning,
  schemas.agent_reasoning_raw_content,
  schemas.entered_review_mode,
  schemas.exited_review_mode,
  schemas.patch_apply_end,
  schemas.context_compacted,
  schemas.mcp_tool_call_end,
  schemas.web_search_end,
  schemas.image_generation_end,
  schemas.sub_agent_activity,
]);

export type CodexEventMessage = z.infer<typeof codexEventMessageSchema>;
