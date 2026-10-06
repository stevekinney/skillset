import { z } from 'zod';

import {
  claudePermissionUpdateSchema,
  recordSchema,
  type ClaudeHookEventName,
} from './claude-hook-shared.js';

const additionalContext = { additionalContext: z.string().optional() };
const watchPaths = { watchPaths: z.array(z.string()).optional() };
const elicitationAction = {
  action: z.enum(['accept', 'decline', 'cancel']).optional(),
  content: recordSchema.optional(),
};

function variant<Name extends ClaudeHookEventName, Shape extends z.ZodRawShape>(
  name: Name,
  shape: Shape,
) {
  return z.looseObject({ hookEventName: z.literal(name), ...shape });
}

/**
 * `hookSpecificOutput` has 22 variants, one per event that can return event
 * specific data. SessionEnd, StopFailure, PreCompact, PostCompact,
 * TeammateIdle, TaskCreated, TaskCompleted, InstructionsLoaded, ConfigChange,
 * DirectoryAdded, and WorktreeRemove have none. The Setup and Notification
 * variants validate but are inert: Claude Code discards their output.
 */
export const claudeHookSpecificOutputSchemas = {
  PreToolUse: variant('PreToolUse', {
    permissionDecision: z.enum(['allow', 'deny', 'ask', 'defer']).optional(),
    permissionDecisionReason: z.string().optional(),
    updatedInput: recordSchema.optional(),
    ...additionalContext,
  }),
  PermissionRequest: variant('PermissionRequest', {
    decision: z.discriminatedUnion('behavior', [
      z.looseObject({
        behavior: z.literal('allow'),
        updatedInput: recordSchema.optional(),
        updatedPermissions: z.array(claudePermissionUpdateSchema).optional(),
      }),
      z.looseObject({
        behavior: z.literal('deny'),
        message: z.string().optional(),
        interrupt: z.boolean().optional(),
      }),
    ]),
  }),
  PostToolUse: variant('PostToolUse', {
    ...additionalContext,
    classifierContext: z.string().optional(),
    updatedToolOutput: z.unknown().optional(),
    // Deprecated in favor of `updatedToolOutput`.
    updatedMCPToolOutput: z.unknown().optional(),
  }),
  PostToolUseFailure: variant('PostToolUseFailure', additionalContext),
  PostToolBatch: variant('PostToolBatch', additionalContext),
  UserPromptSubmit: variant('UserPromptSubmit', {
    ...additionalContext,
    sessionTitle: z.string().optional(),
    suppressOriginalPrompt: z.boolean().optional(),
  }),
  UserPromptExpansion: variant('UserPromptExpansion', {
    ...additionalContext,
    suppressOriginalPrompt: z.boolean().optional(),
  }),
  SessionStart: variant('SessionStart', {
    ...additionalContext,
    initialUserMessage: z.string().optional(),
    sessionTitle: z.string().optional(),
    ...watchPaths,
    reloadSkills: z.boolean().optional(),
  }),
  Setup: variant('Setup', additionalContext),
  SubagentStart: variant('SubagentStart', additionalContext),
  Stop: variant('Stop', additionalContext),
  SubagentStop: variant('SubagentStop', additionalContext),
  PermissionDenied: variant('PermissionDenied', { retry: z.boolean().optional() }),
  Notification: variant('Notification', additionalContext),
  Elicitation: variant('Elicitation', elicitationAction),
  ElicitationResult: variant('ElicitationResult', elicitationAction),
  CwdChanged: variant('CwdChanged', watchPaths),
  FileChanged: variant('FileChanged', watchPaths),
  // HTTP hooks only; command hooks print the path as the last non-empty stdout line instead.
  WorktreeCreate: variant('WorktreeCreate', { worktreePath: z.string() }),
  MessageDisplay: variant('MessageDisplay', { displayContent: z.string().optional() }),
  PreModelSwitch: variant('PreModelSwitch', {
    permissionDecision: z.enum(['allow', 'deny', 'ask']).optional(),
    permissionDecisionReason: z.string().optional(),
  }),
  PostModelSwitch: variant('PostModelSwitch', additionalContext),
} as const;

export const claudeHookSpecificOutputSchema = z.discriminatedUnion('hookEventName', [
  claudeHookSpecificOutputSchemas.PreToolUse,
  claudeHookSpecificOutputSchemas.PostToolUse,
  claudeHookSpecificOutputSchemas.PostToolUseFailure,
  claudeHookSpecificOutputSchemas.PostToolBatch,
  claudeHookSpecificOutputSchemas.Notification,
  claudeHookSpecificOutputSchemas.UserPromptSubmit,
  claudeHookSpecificOutputSchemas.UserPromptExpansion,
  claudeHookSpecificOutputSchemas.SessionStart,
  claudeHookSpecificOutputSchemas.Stop,
  claudeHookSpecificOutputSchemas.SubagentStart,
  claudeHookSpecificOutputSchemas.SubagentStop,
  claudeHookSpecificOutputSchemas.PreModelSwitch,
  claudeHookSpecificOutputSchemas.PostModelSwitch,
  claudeHookSpecificOutputSchemas.PermissionRequest,
  claudeHookSpecificOutputSchemas.PermissionDenied,
  claudeHookSpecificOutputSchemas.Setup,
  claudeHookSpecificOutputSchemas.Elicitation,
  claudeHookSpecificOutputSchemas.ElicitationResult,
  claudeHookSpecificOutputSchemas.WorktreeCreate,
  claudeHookSpecificOutputSchemas.CwdChanged,
  claudeHookSpecificOutputSchemas.FileChanged,
  claudeHookSpecificOutputSchemas.MessageDisplay,
]);

/**
 * What a hook may print to stdout as JSON. The binary accepts a top-level
 * `decision` of `approve` or `block`; the docs say `block` is the only value.
 * `suppressOutput` is accepted but has no effect. `hookSpecificOutput` must
 * name the event being run or Claude Code throws.
 */
export const claudeHookOutputSchema = z.looseObject({
  continue: z.boolean().optional(),
  suppressOutput: z.boolean().optional(),
  stopReason: z.string().optional(),
  decision: z.enum(['approve', 'block']).optional(),
  reason: z.string().optional(),
  systemMessage: z.string().optional(),
  terminalSequence: z.string().optional(),
  hookSpecificOutput: claudeHookSpecificOutputSchema.optional(),
});

/** The async form a hook may print instead: it keeps running and reports later. */
export const claudeAsyncHookOutputSchema = z.looseObject({
  async: z.literal(true),
  asyncTimeout: z.number().optional(),
});

export type ClaudeHookOutput = z.infer<typeof claudeHookOutputSchema>;
export type ClaudeAsyncHookOutput = z.infer<typeof claudeAsyncHookOutputSchema>;

/** Everything a command hook may print: a synchronous output or the async form. */
export const claudeHookOutputOrAsyncSchema = z.union([
  claudeAsyncHookOutputSchema,
  claudeHookOutputSchema,
]);

/** Parse what a hook printed to stdout, accepting either the regular or the async form. */
export function parseClaudeHookOutput(payload: unknown): ClaudeHookOutput | ClaudeAsyncHookOutput {
  return claudeHookOutputOrAsyncSchema.parse(payload);
}

/** Like {@link parseClaudeHookOutput} but returns a result instead of throwing. */
export function safeParseClaudeHookOutput(payload: unknown) {
  return claudeHookOutputOrAsyncSchema.safeParse(payload);
}

export type ClaudeHookSpecificOutput = z.infer<typeof claudeHookSpecificOutputSchema>;

export type ClaudeHookOutputOrAsync = z.infer<typeof claudeHookOutputOrAsyncSchema>;
