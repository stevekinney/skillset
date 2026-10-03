import { z } from 'zod';

import {
  backgroundTaskSchema,
  claudePermissionUpdateSchema,
  claudeStopFailureErrors,
  compactTriggerSchema,
  elicitationModeSchema,
  inputFor,
  mcpServerSchema,
  modelSwitchShape,
  recordSchema,
  sessionCronSchema,
  toolFields,
  type ClaudeHookEventName,
} from './claude-hook-shared.js';

/** stdin schema for each Claude Code hook event, keyed by `hook_event_name`. */
export const claudeHookInputSchemas = {
  PreToolUse: inputFor('PreToolUse', toolFields),
  PostToolUse: inputFor('PostToolUse', {
    ...toolFields,
    tool_response: z.unknown(),
    duration_ms: z.number().optional(),
  }),
  PostToolUseFailure: inputFor('PostToolUseFailure', {
    ...toolFields,
    error: z.string(),
    is_interrupt: z.boolean().optional(),
    duration_ms: z.number().optional(),
  }),
  PostToolBatch: inputFor('PostToolBatch', {
    // `tool_response` is the serialized tool_result content the model sees, not the structured output.
    tool_calls: z.array(
      z.looseObject({
        tool_name: z.string(),
        tool_input: z.unknown(),
        tool_use_id: z.string(),
        tool_response: z.unknown().optional(),
      }),
    ),
  }),
  Notification: inputFor('Notification', {
    message: z.string(),
    title: z.string().optional(),
    // A plain string in the binary; documented values include permission_prompt and idle_prompt.
    notification_type: z.string(),
  }),
  UserPromptSubmit: inputFor('UserPromptSubmit', {
    prompt: z.string(),
    // In the binary but not in the docs; the binary says payloads may omit it while it rolls out.
    source: z
      .enum(['user', 'sdk', 'system', 'loop_wakeup', 'schedule_wakeup', 'poll_event'])
      .optional(),
    session_title: z.string().optional(),
  }),
  UserPromptExpansion: inputFor('UserPromptExpansion', {
    expansion_type: z.enum(['slash_command', 'mcp_prompt']),
    command_name: z.string(),
    command_args: z.string(),
    command_source: z.string().optional(),
    prompt: z.string(),
  }),
  SessionStart: inputFor('SessionStart', {
    source: z.enum(['startup', 'resume', 'clear', 'compact', 'fork']),
    model: z.string().optional(),
    session_title: z.string().optional(),
    seconds_since_last_response: z.number().optional(),
    context_tokens: z.number().optional(),
    prompt_cache_likely_expired: z.boolean().optional(),
    estimated_cache_write_usd: z.number().optional(),
  }),
  SessionEnd: inputFor('SessionEnd', {
    // The docs also list `bypass_permissions_disabled`, removed in 2.1.234 and no longer sent.
    reason: z.enum(['clear', 'resume', 'logout', 'prompt_input_exit', 'other']),
  }),
  Stop: inputFor('Stop', {
    stop_hook_active: z.boolean(),
    last_assistant_message: z.string().optional(),
    background_tasks: z.array(backgroundTaskSchema).optional(),
    session_crons: z.array(sessionCronSchema).optional(),
  }),
  StopFailure: inputFor('StopFailure', {
    error: z.enum(claudeStopFailureErrors),
    error_details: z.string().optional(),
    last_assistant_message: z.string().optional(),
  }),
  SubagentStart: inputFor('SubagentStart', {
    agent_id: z.string(),
    agent_type: z.string(),
  }),
  SubagentStop: inputFor('SubagentStop', {
    stop_hook_active: z.boolean(),
    agent_id: z.string(),
    // The subagent's own transcript; `transcript_path` is the main session's.
    agent_transcript_path: z.string(),
    agent_type: z.string(),
    last_assistant_message: z.string().optional(),
    background_tasks: z.array(backgroundTaskSchema).optional(),
    session_crons: z.array(sessionCronSchema).optional(),
  }),
  PreCompact: inputFor('PreCompact', {
    trigger: compactTriggerSchema,
    custom_instructions: z.string().nullable(),
  }),
  PostCompact: inputFor('PostCompact', {
    trigger: compactTriggerSchema,
    compact_summary: z.string(),
  }),
  PreModelSwitch: inputFor('PreModelSwitch', {
    ...modelSwitchShape,
    source: z.enum(['command', 'picker', 'sdk']),
  }),
  PostModelSwitch: inputFor('PostModelSwitch', {
    ...modelSwitchShape,
    source: z.enum(['command', 'picker', 'sdk', 'auto', 'resume']),
  }),
  PermissionRequest: inputFor('PermissionRequest', {
    tool_name: z.string(),
    tool_input: z.unknown(),
    permission_suggestions: z.array(claudePermissionUpdateSchema).optional(),
    mcp_server: mcpServerSchema.optional(),
  }),
  PermissionDenied: inputFor('PermissionDenied', {
    ...toolFields,
    reason: z.string(),
  }),
  Setup: inputFor('Setup', { trigger: z.enum(['init', 'maintenance']) }),
  TeammateIdle: inputFor('TeammateIdle', {
    teammate_name: z.string(),
    // Deprecated; Claude Code says it will be removed in a future release.
    team_name: z.string(),
  }),
  TaskCreated: inputFor('TaskCreated', {
    task_id: z.string(),
    task_subject: z.string(),
    task_description: z.string().optional(),
    teammate_name: z.string().optional(),
    team_name: z.string().optional(),
  }),
  TaskCompleted: inputFor('TaskCompleted', {
    task_id: z.string(),
    task_subject: z.string(),
    task_description: z.string().optional(),
    teammate_name: z.string().optional(),
    team_name: z.string().optional(),
  }),
  Elicitation: inputFor('Elicitation', {
    mcp_server_name: z.string(),
    message: z.string(),
    mode: elicitationModeSchema.optional(),
    url: z.string().optional(),
    elicitation_id: z.string().optional(),
    requested_schema: recordSchema.optional(),
  }),
  ElicitationResult: inputFor('ElicitationResult', {
    mcp_server_name: z.string(),
    elicitation_id: z.string().optional(),
    mode: elicitationModeSchema.optional(),
    action: z.enum(['accept', 'decline', 'cancel']),
    content: recordSchema.optional(),
  }),
  ConfigChange: inputFor('ConfigChange', {
    source: z.enum([
      'user_settings',
      'project_settings',
      'local_settings',
      'policy_settings',
      'skills',
    ]),
    file_path: z.string().optional(),
  }),
  WorktreeCreate: inputFor('WorktreeCreate', { name: z.string() }),
  WorktreeRemove: inputFor('WorktreeRemove', { worktree_path: z.string() }),
  InstructionsLoaded: inputFor('InstructionsLoaded', {
    file_path: z.string(),
    memory_type: z.enum(['User', 'Project', 'Local', 'Managed']),
    load_reason: z.enum([
      'session_start',
      'nested_traversal',
      'path_glob_match',
      'include',
      'compact',
    ]),
    globs: z.array(z.string()).optional(),
    trigger_file_path: z.string().optional(),
    parent_file_path: z.string().optional(),
  }),
  CwdChanged: inputFor('CwdChanged', { old_cwd: z.string(), new_cwd: z.string() }),
  FileChanged: inputFor('FileChanged', {
    file_path: z.string(),
    event: z.enum(['change', 'add', 'unlink']),
  }),
  DirectoryAdded: inputFor('DirectoryAdded', {
    directory: z.string(),
    source: z.enum(['slash_command', 'register_repo_root']),
  }),
  MessageDisplay: inputFor('MessageDisplay', {
    turn_id: z.string(),
    message_id: z.string(),
    index: z.number().int(),
    final: z.boolean(),
    delta: z.string(),
  }),
} as const satisfies Record<ClaudeHookEventName, z.ZodType>;

/** Any Claude Code hook stdin payload, discriminated on `hook_event_name`. */
export const claudeHookInputSchema = z.discriminatedUnion('hook_event_name', [
  claudeHookInputSchemas.PreToolUse,
  claudeHookInputSchemas.PostToolUse,
  claudeHookInputSchemas.PostToolUseFailure,
  claudeHookInputSchemas.PostToolBatch,
  claudeHookInputSchemas.Notification,
  claudeHookInputSchemas.UserPromptSubmit,
  claudeHookInputSchemas.UserPromptExpansion,
  claudeHookInputSchemas.SessionStart,
  claudeHookInputSchemas.SessionEnd,
  claudeHookInputSchemas.Stop,
  claudeHookInputSchemas.StopFailure,
  claudeHookInputSchemas.SubagentStart,
  claudeHookInputSchemas.SubagentStop,
  claudeHookInputSchemas.PreCompact,
  claudeHookInputSchemas.PostCompact,
  claudeHookInputSchemas.PreModelSwitch,
  claudeHookInputSchemas.PostModelSwitch,
  claudeHookInputSchemas.PermissionRequest,
  claudeHookInputSchemas.PermissionDenied,
  claudeHookInputSchemas.Setup,
  claudeHookInputSchemas.TeammateIdle,
  claudeHookInputSchemas.TaskCreated,
  claudeHookInputSchemas.TaskCompleted,
  claudeHookInputSchemas.Elicitation,
  claudeHookInputSchemas.ElicitationResult,
  claudeHookInputSchemas.ConfigChange,
  claudeHookInputSchemas.WorktreeCreate,
  claudeHookInputSchemas.WorktreeRemove,
  claudeHookInputSchemas.InstructionsLoaded,
  claudeHookInputSchemas.CwdChanged,
  claudeHookInputSchemas.FileChanged,
  claudeHookInputSchemas.DirectoryAdded,
  claudeHookInputSchemas.MessageDisplay,
]);

export type ClaudeHookInput = z.infer<typeof claudeHookInputSchema>;
/** The stdin payload of one specific event, for example `ClaudeHookInputFor<'Stop'>`. */
export type ClaudeHookInputFor<Name extends ClaudeHookEventName> = z.infer<
  (typeof claudeHookInputSchemas)[Name]
>;

/** Parse a stdin payload, dispatching on `hook_event_name`. Throws a `ZodError` on mismatch. */
export function parseClaudeHookInput(payload: unknown): ClaudeHookInput {
  return claudeHookInputSchema.parse(payload);
}

/** Like {@link parseClaudeHookInput} but returns a result instead of throwing. */
export function safeParseClaudeHookInput(payload: unknown) {
  return claudeHookInputSchema.safeParse(payload);
}
