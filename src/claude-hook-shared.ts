import { z } from 'zod';

/**
 * Zod schemas for the JSON Claude Code 2.1.288 writes to a hook's stdin and
 * the JSON a hook may print to stdout, one pair per lifecycle event.
 *
 * Every payload is a `z.looseObject`: Claude Code adds fields over time, and
 * parsing a real payload must never fail on a field this version has not
 * heard of. Unknown keys survive into the parsed value.
 *
 * Sources: the binary's embedded Zod schemas plus code.claude.com/docs/en/hooks
 * (verified 2026-10-03). Where the binary and the docs disagree the schema
 * here follows the binary, and the difference is noted inline.
 */

/** Every lifecycle event Claude Code 2.1.288 emits, in the binary's own order. */
export const claudeHookEventNames = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'DirectoryAdded',
  'MessageDisplay',
] as const;

export type ClaudeHookEventName = (typeof claudeHookEventNames)[number];

/**
 * Fields every event may carry. `permission_mode` is a plain string in the
 * binary (runtime values: default, acceptEdits, bypassPermissions, plan,
 * dontAsk, auto). `scratchpad_dir` is sent at runtime since 2.1.257 but is
 * missing from the binary's exported schema. Which of these a given event
 * actually sends varies; all are optional except the first three.
 */
export const commonInputShape = {
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  scratchpad_dir: z.string().optional(),
  prompt_id: z.string().optional(),
  permission_mode: z.string().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  effort: z.looseObject({ level: z.string() }).optional(),
};

/** Common fields every Claude hook input shares. */
export const claudeCommonHookInputSchema = z.looseObject(commonInputShape);

/** Build one event's input schema: the common fields, the event literal, and its own fields. */
export function inputFor<Name extends ClaudeHookEventName, Shape extends z.ZodRawShape>(
  name: Name,
  shape: Shape,
) {
  return z.looseObject({ ...commonInputShape, hook_event_name: z.literal(name), ...shape });
}

export const mcpServerSchema = z.looseObject({ name: z.string(), source: z.string() });

/** `PermissionUpdate` entries: `permission_suggestions` on input, `updatedPermissions` on output. */
const permissionDestinationSchema = z.enum([
  'userSettings',
  'projectSettings',
  'localSettings',
  'session',
  'cliArg',
]);
const permissionRuleSchema = z.looseObject({
  toolName: z.string(),
  ruleContent: z.string().optional(),
});
const permissionBehaviorSchema = z.enum(['allow', 'deny', 'ask']);

function ruleUpdate<Type extends 'addRules' | 'replaceRules' | 'removeRules'>(type: Type) {
  return z.looseObject({
    type: z.literal(type),
    rules: z.array(permissionRuleSchema),
    behavior: permissionBehaviorSchema,
    destination: permissionDestinationSchema,
  });
}

function directoryUpdate<Type extends 'addDirectories' | 'removeDirectories'>(type: Type) {
  return z.looseObject({
    type: z.literal(type),
    directories: z.array(z.string()),
    destination: permissionDestinationSchema,
  });
}

export const claudePermissionUpdateSchema = z.discriminatedUnion('type', [
  ruleUpdate('addRules'),
  ruleUpdate('replaceRules'),
  ruleUpdate('removeRules'),
  z.looseObject({
    type: z.literal('setMode'),
    // `manual` is accepted as an alias of `default` (2.1.200+).
    mode: z.enum([
      'acceptEdits',
      'auto',
      'bypassPermissions',
      'default',
      'dontAsk',
      'plan',
      'manual',
    ]),
    destination: permissionDestinationSchema,
  }),
  directoryUpdate('addDirectories'),
  directoryUpdate('removeDirectories'),
]);
export type ClaudePermissionUpdate = z.infer<typeof claudePermissionUpdateSchema>;

export const backgroundTaskSchema = z.looseObject({
  id: z.string(),
  // A friendly label (shell, subagent, monitor, workflow) or the raw discriminant: not an enum.
  type: z.string(),
  status: z.string(),
  description: z.string(),
  command: z.string().optional(),
  agent_type: z.string().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  name: z.string().optional(),
});

export const sessionCronSchema = z.looseObject({
  id: z.string(),
  schedule: z.string(),
  recurring: z.boolean(),
  prompt: z.string(),
});

/** The 13 `StopFailure.error` values in the binary (the docs list 12; `verification_required` is the extra). */
export const claudeStopFailureErrors = [
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'rate_limit',
  'overloaded',
  'invalid_request',
  'model_not_found',
  'server_error',
  'unknown',
  'max_output_tokens',
  'cloud_credential_error',
] as const;

export const compactTriggerSchema = z.enum(['manual', 'auto']);
export const elicitationModeSchema = z.enum(['form', 'url']);
export const recordSchema = z.record(z.string(), z.unknown());

export const modelSwitchShape = {
  from_model: z.string(),
  to_model: z.string(),
  requested_model: z.string().nullable(),
  context_tokens: z.number(),
  prompt_cache_warm: z.boolean(),
  cache_ttl: z.enum(['5m', '1h']),
  estimated_cache_write_usd: z.number(),
  pricing: z.enum(['configured', 'catalog', 'default']),
};

export const toolFields = {
  tool_name: z.string(),
  tool_input: z.unknown(),
  tool_use_id: z.string(),
  mcp_server: mcpServerSchema.optional(),
};

export type ClaudeCommonHookInput = z.infer<typeof claudeCommonHookInputSchema>;
