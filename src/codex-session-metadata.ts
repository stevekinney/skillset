import { z } from 'zod';

import {
  activePermissionProfileSchema,
  approvalPolicySchema,
  approvalsReviewerSchema,
  collaborationModeSchema,
  cyberAccessProgramSchema,
  fileSystemSandboxPolicySchema,
  historyModeSchema,
  multiAgentModeSchema,
  multiAgentVersionSchema,
  openEnum,
  permissionProfileSchema,
  personalitySchema,
  reasoningEffortSchema,
  reasoningSummarySchema,
  sandboxPolicySchema,
} from './codex-session-shared.js';

/**
 * The `session_meta` and `turn_context` record payloads.
 *
 * Sources: `SessionMeta`, `SessionMetaLine`, `SessionSource`, `TurnContextItem`
 * and `BaseInstructions` in `codex-rs/protocol/src` at `rust-v0.160.0`.
 *
 * Left loose on purpose:
 * - `session_meta.dynamic_tools[].inputSchema` and `.tools[].inputSchema`: JSON
 *   Schema documents Codex only forwards to the model.
 * - `session_meta.selected_capability_roots[]`: no real file contains one.
 */

/** `SessionSource`: a bare string for unit variants, a one-key object for the data variants. */
export const sessionSourceSchema = z.union([
  z.enum(['cli', 'vscode', 'exec', 'mcp', 'unknown']),
  z.looseObject({ custom: z.string() }),
  z.looseObject({ internal: z.enum(['memory_consolidation', 'guardian']) }),
  z.looseObject({
    subagent: z.union([
      z.enum(['review', 'compact', 'memory_consolidation']),
      z.looseObject({
        thread_spawn: z.looseObject({
          parent_thread_id: z.string(),
          depth: z.number(),
          agent_path: z.string().nullable().optional(),
          agent_nickname: z.string().nullable().optional(),
          agent_role: z.string().nullable().optional(),
        }),
      }),
      z.looseObject({ other: z.string() }),
    ]),
  }),
]);

/**
 * `ThreadSource` is a string newtype whose `Feature(String)` variant carries
 * any other value, so it is open. The last four literals are the feature names
 * seen in real files.
 */
export const threadSourceSchema = openEnum([
  'user',
  'subagent',
  'guardian_review',
  'memory_consolidation',
  // Feature names Codex Desktop writes.
  'automation',
  'agent_created_thread',
  'system',
  'pull_request_fix_automation',
]);

/** `originator` is a free string; these are the clients Codex ships. */
export const originatorSchema = openEnum([
  'Codex Desktop',
  'codex_exec',
  'codex_cli_rs',
  'codex-tui',
  'codex_work_desktop',
  'codex_sdk_ts',
]);

const dynamicToolFunctionSchema = z.looseObject({
  type: z.literal('function'),
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  deferLoading: z.boolean().optional(),
});

const dynamicToolSchema = z.discriminatedUnion('type', [
  dynamicToolFunctionSchema,
  z.looseObject({
    type: z.literal('namespace'),
    name: z.string(),
    description: z.string(),
    tools: z.array(dynamicToolFunctionSchema),
  }),
]);

export const codexSessionMetaPayloadSchema = z.looseObject({
  creator_user_id: z.string().optional(),
  creator_account_id: z.string().optional(),
  // Older rollouts omit `session_id`; Codex then reuses `id`.
  session_id: z.string().optional(),
  id: z.string(),
  forked_from_id: z.string().optional(),
  forked_from_ordinal_exclusive: z.number().optional(),
  parent_thread_id: z.string().optional(),
  timestamp: z.string(),
  cwd: z.string(),
  runtime_workspace_roots: z.array(z.string()).optional(),
  originator: originatorSchema,
  cli_version: z.string(),
  source: sessionSourceSchema.optional(),
  thread_source: threadSourceSchema.optional(),
  agent_nickname: z.string().optional(),
  agent_role: z.string().optional(),
  agent_path: z.string().optional(),
  model_provider: z.string().nullable(),
  base_instructions: z
    .looseObject({
      text: z.string().optional(),
      provenance: z
        .discriminatedUnion('type', [
          z.looseObject({ type: z.literal('custom') }),
          z.looseObject({ type: z.literal('model'), model: z.string() }),
        ])
        .optional(),
    })
    .nullable(),
  dynamic_tools: z.array(dynamicToolSchema).optional(),
  selected_capability_roots: z.array(z.record(z.string(), z.unknown())).optional(),
  memory_mode: z.string().optional(),
  history_mode: historyModeSchema.optional(),
  history_base: z
    .looseObject({
      thread_id: z.string(),
      end_ordinal_exclusive: z.number(),
      end_byte_offset: z.number(),
    })
    .optional(),
  subagent_history_start_ordinal: z.number().optional(),
  multi_agent_version: multiAgentVersionSchema.optional(),
  context_window: z.looseObject({ window_id: z.string() }).optional(),
  git: z
    .looseObject({
      commit_hash: z.string().optional(),
      branch: z.string().optional(),
      repository_url: z.string().optional(),
    })
    .optional(),
});

export const codexTurnContextPayloadSchema = z.looseObject({
  turn_id: z.string().optional(),
  root_turn_id: z.string().optional(),
  disabled_plugin_ids: z.array(z.string()).optional(),
  cwd: z.string(),
  workspace_roots: z.array(z.string()).optional(),
  current_date: z.string().optional(),
  timezone: z.string().optional(),
  approval_policy: approvalPolicySchema,
  approvals_reviewer: approvalsReviewerSchema.optional(),
  sandbox_policy: sandboxPolicySchema,
  permission_profile: permissionProfileSchema.optional(),
  active_permission_profile: activePermissionProfileSchema.optional(),
  network: z
    .looseObject({
      allowed_domains: z.array(z.string()),
      denied_domains: z.array(z.string()),
    })
    .optional(),
  file_system_sandbox_policy: fileSystemSandboxPolicySchema.optional(),
  model: z.string(),
  comp_hash: z.string().optional(),
  personality: personalitySchema.optional(),
  collaboration_mode: collaborationModeSchema.optional(),
  multi_agent_version: multiAgentVersionSchema.optional(),
  multi_agent_mode: multiAgentModeSchema.optional(),
  realtime_active: z.boolean().optional(),
  cyber_access_program: cyberAccessProgramSchema.optional(),
  effort: reasoningEffortSchema.optional(),
  summary: reasoningSummarySchema,
});
