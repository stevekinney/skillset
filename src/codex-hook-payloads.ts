import { z } from 'zod';

/**
 * Zod schemas for the JSON Codex 0.160.0 writes to a hook's stdin and the
 * JSON a hook may print to stdout, one pair per lifecycle event.
 *
 * Inputs are `z.looseObject`: Codex only serializes them, and later versions
 * may add fields, so an unknown key must not fail a parse. Outputs are
 * `z.strictObject`, mirroring Codex's `deny_unknown_fields`: one unknown key
 * anywhere in a hook's stdout makes Codex mark the whole run Failed, so a
 * strict schema is how an author finds that out before Codex does.
 *
 * Sources: the generated JSON schemas in `codex-rs/hooks/schema/generated`,
 * the serde structs, and the hooks docs at `rust-v0.160.0` (verified
 * 2026-10-03).
 */

/** Every lifecycle event Codex 0.160.0 emits. */
export const codexHookEventNames = [
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'Stop',
  'SubagentStop',
  'Interrupt',
] as const;

export type CodexHookEventName = (typeof codexHookEventNames)[number];

/**
 * The schema allows five values, but 0.160.0 only ever emits
 * `bypassPermissions` (approval policy never) or `default`.
 */
const permissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
]);

const compactTriggerSchema = z.enum(['manual', 'auto']);

/** `null` when the thread has no transcript; the key is always present. */
const transcriptPathSchema = z.string().nullable();

const baseShape = {
  session_id: z.string(),
  transcript_path: transcriptPathSchema,
  cwd: z.string(),
};

/** Fields on every event except SessionStart and SessionEnd. */
const turnShape = { ...baseShape, model: z.string(), turn_id: z.string() };

/** Present only inside a subagent, so optional wherever a main thread can also fire the event. */
const optionalAgentShape = { agent_id: z.string().optional(), agent_type: z.string().optional() };

function inputFor<Name extends CodexHookEventName, Shape extends z.ZodRawShape>(
  name: Name,
  shape: Shape,
) {
  return z.looseObject({ ...shape, hook_event_name: z.literal(name) });
}

const toolInputShape = {
  ...turnShape,
  ...optionalAgentShape,
  permission_mode: permissionModeSchema,
  tool_name: z.string(),
  tool_input: z.unknown(),
};

/** stdin schema for each Codex hook event, keyed by `hook_event_name`. */
export const codexHookInputSchemas = {
  SessionStart: inputFor('SessionStart', {
    ...baseShape,
    model: z.string(),
    permission_mode: permissionModeSchema,
    // The docs omit `fork`; the generated schema includes it.
    source: z.enum(['startup', 'resume', 'clear', 'compact', 'fork']),
  }),
  // The only event without `model`; `reason` is always `other`.
  SessionEnd: inputFor('SessionEnd', { ...baseShape, reason: z.literal('other') }),
  SubagentStart: inputFor('SubagentStart', {
    ...turnShape,
    permission_mode: permissionModeSchema,
    agent_id: z.string(),
    agent_type: z.string(),
  }),
  UserPromptSubmit: inputFor('UserPromptSubmit', {
    ...turnShape,
    ...optionalAgentShape,
    permission_mode: permissionModeSchema,
    prompt: z.string(),
  }),
  PreToolUse: inputFor('PreToolUse', { ...toolInputShape, tool_use_id: z.string() }),
  // No `tool_use_id`.
  PermissionRequest: inputFor('PermissionRequest', toolInputShape),
  PostToolUse: inputFor('PostToolUse', {
    ...toolInputShape,
    tool_use_id: z.string(),
    tool_response: z.unknown(),
  }),
  PreCompact: inputFor('PreCompact', {
    ...turnShape,
    ...optionalAgentShape,
    trigger: compactTriggerSchema,
  }),
  PostCompact: inputFor('PostCompact', {
    ...turnShape,
    ...optionalAgentShape,
    trigger: compactTriggerSchema,
  }),
  Stop: inputFor('Stop', {
    ...turnShape,
    permission_mode: permissionModeSchema,
    stop_hook_active: z.boolean(),
    last_assistant_message: z.string().nullable(),
  }),
  SubagentStop: inputFor('SubagentStop', {
    ...turnShape,
    permission_mode: permissionModeSchema,
    agent_id: z.string(),
    agent_type: z.string(),
    // The subagent's own transcript; `transcript_path` is the parent's.
    agent_transcript_path: z.string().nullable(),
    stop_hook_active: z.boolean(),
    last_assistant_message: z.string().nullable(),
  }),
  Interrupt: inputFor('Interrupt', { ...turnShape, permission_mode: permissionModeSchema }),
} as const satisfies Record<CodexHookEventName, z.ZodType>;

/** Any Codex hook stdin payload, discriminated on `hook_event_name`. */
export const codexHookInputSchema = z.discriminatedUnion('hook_event_name', [
  codexHookInputSchemas.SessionStart,
  codexHookInputSchemas.SessionEnd,
  codexHookInputSchemas.SubagentStart,
  codexHookInputSchemas.UserPromptSubmit,
  codexHookInputSchemas.PreToolUse,
  codexHookInputSchemas.PermissionRequest,
  codexHookInputSchemas.PostToolUse,
  codexHookInputSchemas.PreCompact,
  codexHookInputSchemas.PostCompact,
  codexHookInputSchemas.Stop,
  codexHookInputSchemas.SubagentStop,
  codexHookInputSchemas.Interrupt,
]);

export type CodexHookInput = z.infer<typeof codexHookInputSchema>;
/** The stdin payload of one specific event, for example `CodexHookInputFor<'Stop'>`. */
export type CodexHookInputFor<Name extends CodexHookEventName> = z.infer<
  (typeof codexHookInputSchemas)[Name]
>;

/**
 * The four fields flattened into ten events' output. `suppressOutput` is
 * parsed and discarded.
 */
const universalOutputShape = {
  continue: z.boolean().optional(),
  stopReason: z.string().optional(),
  suppressOutput: z.boolean().optional(),
  systemMessage: z.string().optional(),
};

/**
 * The universal fields as PreToolUse, PermissionRequest, and PostToolUse
 * accept them: `continue: false`, any `stopReason`, and `suppressOutput: true`
 * make Codex mark those runs failed, so they are rejected here.
 */
const toolEventUniversalOutputShape = {
  continue: z.literal(true).optional(),
  suppressOutput: z.literal(false).optional(),
  systemMessage: z.string().optional(),
};

const additionalContext = { additionalContext: z.string().optional() };

function specificOutput<Name extends CodexHookEventName, Shape extends z.ZodRawShape>(
  name: Name,
  shape: Shape,
) {
  return z.strictObject({ hookEventName: z.literal(name), ...shape });
}

const contextOutput = <Name extends 'SessionStart' | 'SubagentStart'>(name: Name) =>
  z.strictObject({
    ...universalOutputShape,
    hookSpecificOutput: specificOutput(name, additionalContext).optional(),
  });

const blockDecisionShape = {
  decision: z.literal('block').optional(),
  reason: z.string().optional(),
};

const compactOutput = z.strictObject(universalOutputShape);
const stopOutput = z.strictObject({ ...universalOutputShape, ...blockDecisionShape });

/**
 * stdout schema for each Codex hook event. These cover only what Codex
 * accepts; semantic rules the JSON schema cannot express (a block needs a
 * non-empty `reason`, PreToolUse `allow` needs `updatedInput`, and so on) are
 * documented in the README, not enforced here.
 *
 * SessionEnd has no output schema: Codex never parses its stdout, so any value
 * is accepted.
 */
export const codexHookOutputSchemas = {
  SessionStart: contextOutput('SessionStart'),
  SessionEnd: z.unknown(),
  SubagentStart: contextOutput('SubagentStart'),
  UserPromptSubmit: z.strictObject({
    ...universalOutputShape,
    ...blockDecisionShape,
    hookSpecificOutput: specificOutput('UserPromptSubmit', additionalContext).optional(),
  }),
  PreToolUse: z.strictObject({
    ...toolEventUniversalOutputShape,
    // `approve` parses but Codex treats it as an unsupported value and fails the run.
    decision: z.enum(['approve', 'block']).optional(),
    reason: z.string().optional(),
    hookSpecificOutput: specificOutput('PreToolUse', {
      // `ask` parses but fails the run; `allow` is only valid with `updatedInput`.
      permissionDecision: z.enum(['allow', 'deny', 'ask']).optional(),
      permissionDecisionReason: z.string().optional(),
      updatedInput: z.unknown().optional(),
      ...additionalContext,
    }).optional(),
  }),
  PermissionRequest: z.strictObject({
    ...toolEventUniversalOutputShape,
    hookSpecificOutput: specificOutput('PermissionRequest', {
      decision: z
        .strictObject({
          behavior: z.enum(['allow', 'deny']),
          message: z.string().optional(),
          // Reserved: `updatedInput`, `updatedPermissions`, and `interrupt: true` fail closed.
          updatedInput: z.unknown().optional(),
          updatedPermissions: z.unknown().optional(),
          interrupt: z.boolean().optional(),
        })
        .optional(),
    }).optional(),
  }),
  PostToolUse: z.strictObject({
    ...toolEventUniversalOutputShape,
    ...blockDecisionShape,
    hookSpecificOutput: specificOutput('PostToolUse', {
      ...additionalContext,
      // Present at all fails the run.
      updatedMCPToolOutput: z.unknown().optional(),
    }).optional(),
  }),
  PreCompact: compactOutput,
  PostCompact: compactOutput,
  Stop: stopOutput,
  SubagentStop: stopOutput,
  // Only `systemMessage`: `continue` and every other key fail the parse.
  Interrupt: z.strictObject({ systemMessage: z.string().optional() }),
} as const satisfies Record<CodexHookEventName, z.ZodType>;

/** The stdout JSON for one specific event, for example `CodexHookOutputFor<'Stop'>`. */
export type CodexHookOutputFor<Name extends CodexHookEventName> = z.infer<
  (typeof codexHookOutputSchemas)[Name]
>;
export type CodexHookOutput = CodexHookOutputFor<CodexHookEventName>;

/** Parse a stdin payload, dispatching on `hook_event_name`. Throws a `ZodError` on mismatch. */
export function parseCodexHookInput(payload: unknown): CodexHookInput {
  return codexHookInputSchema.parse(payload);
}

/** Like {@link parseCodexHookInput} but returns a result instead of throwing. */
export function safeParseCodexHookInput(payload: unknown) {
  return codexHookInputSchema.safeParse(payload);
}

/** Parse what a hook printed to stdout against the schema for the event it ran for. */
export function parseCodexHookOutput<Name extends CodexHookEventName>(
  eventName: Name,
  payload: unknown,
): CodexHookOutputFor<Name>;
export function parseCodexHookOutput(eventName: CodexHookEventName, payload: unknown): unknown {
  return codexHookOutputSchemas[eventName].parse(payload);
}

/** Like {@link parseCodexHookOutput} but returns a result instead of throwing. */
export function safeParseCodexHookOutput<Name extends CodexHookEventName>(
  eventName: Name,
  payload: unknown,
): z.ZodSafeParseResult<CodexHookOutputFor<Name>>;
export function safeParseCodexHookOutput(eventName: CodexHookEventName, payload: unknown) {
  return codexHookOutputSchemas[eventName].safeParse(payload);
}
