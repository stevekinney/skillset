import { z } from 'zod';

import { claudeHookEventNames } from './claude-hook-shared.js';
import { attachmentVariant } from './claude-session-attachment-context.js';
import { claudeSessionUserContentBlockSchema } from './claude-session-content-blocks.js';
import { messageOrigin } from './claude-session-shared.js';

/**
 * Attachment variants that report runtime signals to the model: reminders,
 * hook results, task status, queued prompts, plan and auto mode, and the
 * thinking-block bookkeeping. Each is the body of an `attachment` record.
 */

const strings = z.array(z.string());

const taskStatuses = ['running', 'completed', 'failed'] as const;
const taskTypes = ['local_bash', 'local_agent', 'local_workflow', 'mcp_task'] as const;

const hookResult = {
  hookEvent: z.enum(claudeHookEventNames),
  hookName: z.string(),
  toolUseID: z.string(),
};

const messageIndex = z.looseObject({ messageIndex: z.number(), blockIndex: z.number() });

const taskListItem = z.looseObject({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  blocks: strings,
  blockedBy: strings,
});

/** The signal-reporting attachment variants. */
export const claudeSessionSignalAttachments = [
  attachmentVariant('auto_mode', {
    autoModeConsentFlow: z.boolean(),
    bashFirst: z.boolean(),
    bashFirstSteer: z.enum(['relaxed', 'strict']).optional(),
    bypass: z.boolean(),
    steerOnly: z.boolean(),
  }),
  attachmentVariant('auto_mode_exit', { bashFirst: z.boolean(), steerOnly: z.boolean() }),
  attachmentVariant('bash_output_audience_note', { toolUseID: z.string() }),
  attachmentVariant('batching_reminder_sent', {
    clearAt: z.enum(['next_user_message']).optional(),
    model: z.string(),
    text: z.string(),
  }),
  attachmentVariant('command_permissions', { allowedTools: strings }),
  attachmentVariant('goal_status', {
    condition: z.string(),
    met: z.boolean(),
    durationMs: z.number().optional(),
    iterations: z.number().optional(),
    reason: z.string().optional(),
    sentinel: z.boolean().optional(),
    tokens: z.number().optional(),
  }),
  attachmentVariant('hook_additional_context', { ...hookResult, content: strings }),
  attachmentVariant('hook_cancelled', {
    ...hookResult,
    command: z.string(),
    durationMs: z.number(),
    timedOut: z.boolean(),
    timeoutMs: z.number(),
  }),
  attachmentVariant('hook_non_blocking_error', {
    ...hookResult,
    command: z.string(),
    durationMs: z.number(),
    exitCode: z.number(),
    stderr: z.string(),
    stdout: z.string(),
  }),
  attachmentVariant('hook_success', {
    ...hookResult,
    command: z.string(),
    content: z.string().optional(),
    durationMs: z.number(),
    exitCode: z.number(),
    stderr: z.string(),
    stdout: z.string(),
  }),
  attachmentVariant('plan_file_reference', {
    planContent: z.string(),
    planFilePath: z.string(),
  }),
  attachmentVariant('plan_mode', {
    isSubAgent: z.boolean(),
    planExists: z.boolean(),
    planFilePath: z.string(),
    reminderType: z.enum(['full', 'sparse']),
  }),
  attachmentVariant('plan_mode_exit', { planExists: z.boolean(), planFilePath: z.string() }),
  attachmentVariant('queued_command', {
    prompt: z.union([z.string(), z.array(claudeSessionUserContentBlockSchema)]),
    commandMode: z.enum(['prompt', 'task-notification']).optional(),
    delivery_id: z.string().optional(),
    humanTurn: z.boolean().optional(),
    isMeta: z.boolean().optional(),
    origin: messageOrigin.optional(),
    reminderId: z.string().optional(),
    source_uuid: z.string().optional(),
    timestamp: z.string().optional(),
    usage: z
      .looseObject({ durationMs: z.number(), toolUses: z.number(), totalTokens: z.number() })
      .optional(),
  }),
  attachmentVariant('read_truncation_notice', { banner: z.string(), toolUseID: z.string() }),
  attachmentVariant('remote_session_change', {
    commit: z.string(),
    pr: z.string(),
    url: z.string().nullable(),
    sendUserFileHint: z.boolean(),
    managedCommit: z.boolean().optional(),
    managedPr: z.boolean().optional(),
  }),
  attachmentVariant('silent_turn_reminder', { text: z.string() }),
  attachmentVariant('task_reminder', {
    content: z.array(taskListItem),
    itemCount: z.number(),
  }),
  attachmentVariant('task_status', {
    description: z.string(),
    // `null` or a short summary of what changed since the last report.
    deltaSummary: z.string().nullable(),
    outputFilePath: z.string(),
    status: z.enum(taskStatuses),
    taskId: z.string(),
    taskType: z.enum(taskTypes),
    shell: z
      .looseObject({
        command: z.string(),
        kind: z.enum(['bash', 'monitor']),
        toolUseId: z.string(),
      })
      .optional(),
  }),
  attachmentVariant('thinking_drop', {
    blockHashes: strings,
    firstReportForThreadInProcess: z.boolean(),
    model: z.string(),
    querySource: z.string(),
    requestId: z.string(),
    thinkingBlocksSent: z.number(),
    thinkingTurnsSent: z.number(),
    clientChange: z.looseObject({
      baseline: z.enum(['memory', 'none', 'disk']),
      callNumber: z.number(),
      firstChangedMessageIndex: z.number(),
      // A comma-joined list of change kinds (`messagesHistoryChanged,modelChanged`), or `none`.
      kinds: z.string(),
    }),
    newlyDropped: z.looseObject({
      blockCount: z.number(),
      turnCount: z.number(),
      reason: z.enum(['prefix_mismatch', 'model_mismatch']),
      first: messageIndex,
      last: messageIndex,
      reasonCounts: z
        .looseObject({
          model_mismatch: z.number().optional(),
          prefix_mismatch: z.number().optional(),
        })
        .optional(),
    }),
  }),
  attachmentVariant('thinking_stripped', { scope: z.enum(['all']) }),
  attachmentVariant('total_tokens_reminder', { text: z.string() }),
  attachmentVariant('ultra_effort_enter', { reminderType: z.enum(['full', 'sparse']) }),
  attachmentVariant('ultrathink_effort', {}),
] as const;
