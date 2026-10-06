import { z } from 'zod';

import { claudeSessionContextAttachments } from './claude-session-attachment-context.js';
import { claudeSessionSignalAttachments } from './claude-session-attachment-signals.js';
import { transcriptRecord } from './claude-session-shared.js';

/**
 * Attachment types Claude Code 2.1.288 can write but that appear in none of
 * the sessions this schema was checked against. They are accepted by `type`
 * tag alone, with no field checks, rather than guessing at a shape.
 */
export const claudeSessionUnobservedAttachmentTypes = [
  'advisor_stripped',
  'artifact_opening_prefetch',
  'async_hook_response_batch',
  'attention_budget',
  'batching_reminder',
  'budget_usd',
  'context_efficiency',
  'context_sections',
  'coordinator_context',
  'cowork_memory_context',
  'critical_system_reminder',
  'dir_sync_notice',
  'edited_image_file',
  'fork_briefing',
  'inlined_image_paths',
  'language',
  'max_turns_reached',
  'mcp_dropped_tools_delta',
  'mcp_resource',
  'memory_update',
  'opened_file_in_ide',
  'output_token_usage',
  'peer_mention',
  'plan_mode_reentry',
  'poll_events',
  'prefix_delta',
  'proactivity',
  'prompt_render_point',
  'sandbox_instructions',
  'secondary_reminder',
  'secondary_reminder_sent',
  'session_settings',
  'skill_mention',
  'team_context',
  'teammate_shutdown_batch',
  'thread_state',
  'todo_reminder',
  'token_usage',
  'tool_search_usage_reminder',
  'ultra_effort_exit',
  'unknown_command_fallback',
  'workflow_keyword_request',
  'workflow_size_guideline_change',
] as const;

/** The body of an `attachment` record, discriminated on `type`. */
export const claudeSessionAttachmentSchema = z.discriminatedUnion('type', [
  ...claudeSessionContextAttachments,
  ...claudeSessionSignalAttachments,
  z.looseObject({ type: z.enum(claudeSessionUnobservedAttachmentTypes) }),
]);
export type ClaudeSessionAttachment = z.infer<typeof claudeSessionAttachmentSchema>;

/** A message Claude Code rendered to the model on behalf of an attachment. */
const renderedMessage = z.looseObject({ content: z.string() });

/** An `attachment` record: context or a signal Claude Code attached to a turn. */
export const claudeSessionAttachmentRecordSchema = transcriptRecord('attachment', {
  attachment: claudeSessionAttachmentSchema,
  rendered: z.array(renderedMessage).optional(),
  renderedInHumanTurn: z.array(renderedMessage).optional(),
  renderedBesideToolResult: z.boolean().optional(),
  renderedRole: z.enum(['system', 'user']).optional(),
});

export type ClaudeSessionAttachmentRecord = z.infer<typeof claudeSessionAttachmentRecordSchema>;
