import { z } from 'zod';

/**
 * Lifecycle events both tools support. Verified October 2026 against Claude
 * Code 2.1.288 and codex-cli 0.160.0 (official hooks docs, release notes, and
 * the installed binaries' event enums).
 */
const SHARED_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
] as const;

/** Lifecycle events only Claude Code supports, kept to the documented list. */
export const CLAUDE_ONLY_HOOK_EVENTS = new Set([
  'Setup',
  'UserPromptExpansion',
  'StopFailure',
  'PostToolBatch',
  'PermissionDenied',
  'PostToolUseFailure',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'Notification',
  'MessageDisplay',
  'Elicitation',
  'ElicitationResult',
  // Claude Code 2.1.251+.
  'PreModelSwitch',
  'PostModelSwitch',
]);

/** Lifecycle events only Codex supports. */
export const CODEX_ONLY_HOOK_EVENTS = new Set([
  // codex-cli 0.150.0+.
  'Interrupt',
]);

/** Every lifecycle event Claude Code supports. */
export const CLAUDE_HOOK_EVENTS = new Set([...SHARED_HOOK_EVENTS, ...CLAUDE_ONLY_HOOK_EVENTS]);

/** Every lifecycle event Codex supports. */
export const CODEX_HOOK_EVENTS = new Set([...SHARED_HOOK_EVENTS, ...CODEX_ONLY_HOOK_EVENTS]);

// Claude Code's hook handler schema, transcribed from the 2.1.288 binary's own
// Zod definitions (fields marked `@internal` there are included as optional).
// Objects are loose so fields Claude Code doesn't read survive parsing;
// unknownClaudeHookFields reports them.
const commonHandlerFields = {
  if: z.string().optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
};

const cloudField = z.enum(['device', 'skip']).optional();

const claudeHandlerSchemas = {
  command: z.looseObject({
    type: z.literal('command'),
    command: z.string(),
    args: z.array(z.string()).optional(),
    shell: z.enum(['bash', 'powershell']).optional(),
    async: z.boolean().optional(),
    asyncRewake: z.boolean().optional(),
    rewakeMessage: z.string().min(1).optional(),
    rewakeSummary: z.string().min(1).optional(),
    cloud: cloudField,
    ...commonHandlerFields,
  }),
  prompt: z.looseObject({
    type: z.literal('prompt'),
    prompt: z.string(),
    model: z.string().optional(),
    continueOnBlock: z.boolean().optional(),
    ...commonHandlerFields,
  }),
  mcp_tool: z.looseObject({
    type: z.literal('mcp_tool'),
    server: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()).optional(),
    ...commonHandlerFields,
  }),
  http: z.looseObject({
    type: z.literal('http'),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
    allowedEnvVars: z.array(z.string()).optional(),
    cloud: cloudField,
    ...commonHandlerFields,
  }),
  agent: z.looseObject({
    type: z.literal('agent'),
    prompt: z.string(),
    model: z.string().optional(),
    ...commonHandlerFields,
  }),
};

const claudeHookEntrySchema = z.looseObject({
  matcher: z.string().optional(),
  hooks: z.array(
    z.discriminatedUnion('type', [
      claudeHandlerSchemas.command,
      claudeHandlerSchemas.prompt,
      claudeHandlerSchemas.mcp_tool,
      claudeHandlerSchemas.http,
      claudeHandlerSchemas.agent,
    ]),
  ),
});

/**
 * Claude Code's hook settings shape — the `hooks` value in settings.json and
 * in skill and subagent frontmatter: `{<Event>: [{matcher?, hooks: [handler]}]}`.
 * Unknown event names are rejected, as Claude Code's own schema does.
 */
export const claudeHookSettingsSchema = z.partialRecord(
  z.enum([...CLAUDE_HOOK_EVENTS]),
  z.array(claudeHookEntrySchema),
);

/** A validated Claude Code hook settings block. */
export type ClaudeHookSettings = z.infer<typeof claudeHookSettingsSchema>;

const ENTRY_FIELDS = new Set(Object.keys(claudeHookEntrySchema.shape));

/** Paths (`hooks.<Event>[i].hooks[j].<field>`) of every field Claude Code does not read. */
export function unknownClaudeHookFields(settings: ClaudeHookSettings): string[] {
  const unknown: string[] = [];

  for (const [event, entries] of Object.entries(settings)) {
    for (const [entryIndex, entry] of (entries ?? []).entries()) {
      const entryPath = `hooks.${event}[${entryIndex}]`;
      for (const field of Object.keys(entry)) {
        if (!ENTRY_FIELDS.has(field)) unknown.push(`${entryPath}.${field}`);
      }

      for (const [handlerIndex, handler] of entry.hooks.entries()) {
        const known = claudeHandlerSchemas[handler.type].shape;
        for (const field of Object.keys(handler)) {
          if (!(field in known)) unknown.push(`${entryPath}.hooks[${handlerIndex}].${field}`);
        }
      }
    }
  }

  return unknown;
}

/** A problem found while validating a hook handler object. */
export type HandlerProblem = { path: PropertyKey[]; message: string };

function schemaProblems(schema: z.ZodType, value: unknown): HandlerProblem[] {
  const result = schema.safeParse(value);
  if (result.success) return [];

  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

function handlerType(handler: Record<string, unknown>): string {
  return typeof handler['type'] === 'string' ? handler['type'] : 'command';
}

// Codex 0.160.0's hook handler schema (verified October 2026 against
// hook_config.rs and discovery.rs at rust-v0.160.0). Handlers are loose
// because Codex ignores unknown handler keys. `prompt`
// and `agent` handlers parse and are then skipped with a load-failure warning,
// so they are modelled as bare types that Codex never runs.
const codexTimeout = z.number().int().min(0).optional();

const codexHandlerSchemas = {
  command: z.looseObject({
    type: z.literal('command'),
    command: z.string().min(1),
    commandWindows: z.string().optional(),
    command_windows: z.string().optional(),
    timeout: codexTimeout,
    statusMessage: z.string().optional(),
    async: z.boolean().optional(),
    additionalContextLimit: z.number().int().min(0).optional(),
  }),
  mcp_tool: z.looseObject({
    type: z.literal('mcp_tool'),
    server: z.string().min(1),
    tool: z.string().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
    timeout: codexTimeout,
    statusMessage: z.string().optional(),
  }),
  prompt: z.looseObject({ type: z.literal('prompt') }),
  agent: z.looseObject({ type: z.literal('agent') }),
};

const CODEX_HANDLER_SCHEMAS = new Map<string, z.ZodObject>(Object.entries(codexHandlerSchemas));

/** Validate one handler object against Codex's schema for its `type`. */
export function codexHandlerProblems(handler: Record<string, unknown>): HandlerProblem[] {
  const schema = CODEX_HANDLER_SCHEMAS.get(handlerType(handler));

  return schema ? schemaProblems(schema, handler) : [];
}

// An unrecognised `type` is not a schema error: Codex most likely rejects it
// (an internally tagged enum), but that is inferred rather than verified, so
// the schema accepts it.
const codexHandlerSchema = z.looseObject({ type: z.string() }).superRefine((handler, context) => {
  for (const problem of codexHandlerProblems(handler)) {
    context.addIssue({ code: 'custom', path: problem.path, message: problem.message });
  }
});

const codexMatcherGroupSchema = z.looseObject({
  matcher: z.string().nullish(),
  hooks: z.array(codexHandlerSchema).optional(),
});

const codexEventTables = Object.fromEntries(
  [...CODEX_HOOK_EVENTS].map((event) => [event, z.array(codexMatcherGroupSchema).optional()]),
);

/**
 * Codex's `[hooks]` table (config.toml, hooks.json, and agent role files): one
 * array of matcher groups per PascalCase event, plus an optional `state` table
 * of per-hook trust records.
 */
export const codexHookSettingsSchema = z.looseObject({
  ...codexEventTables,
  state: z
    .record(
      z.string(),
      z.looseObject({ enabled: z.boolean().optional(), trusted_hash: z.string().optional() }),
    )
    .optional(),
});

/** A validated Codex hook settings table. */
export type CodexHookSettings = z.infer<typeof codexHookSettingsSchema>;
