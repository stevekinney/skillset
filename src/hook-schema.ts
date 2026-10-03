import { z } from 'zod';

import type { Target } from './frontmatter.js';

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

/**
 * Claude-only events that a hook may target with `targets: [claude]`. Kept to
 * the documented list so doctor can catch typos in event names.
 */
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

/** Codex-only events that a hook may target with `targets: [codex]`. */
export const CODEX_ONLY_HOOK_EVENTS = new Set([
  // codex-cli 0.150.0+.
  'Interrupt',
]);

/** Every lifecycle event Claude Code supports. */
export const CLAUDE_HOOK_EVENTS = new Set([...SHARED_HOOK_EVENTS, ...CLAUDE_ONLY_HOOK_EVENTS]);

/** Every lifecycle event Codex supports. */
export const CODEX_HOOK_EVENTS = new Set([...SHARED_HOOK_EVENTS, ...CODEX_ONLY_HOOK_EVENTS]);

/** Whether a target supports a hook event. */
export function supportsHookEvent(target: Target, event: string): boolean {
  return (target === 'claude' ? CLAUDE_HOOK_EVENTS : CODEX_HOOK_EVENTS).has(event);
}

// Claude Code's hook handler schema, transcribed from the 2.1.288 binary's own
// Zod definitions (fields marked `@internal` there are included as optional).
// Objects are loose so fields Claude Code doesn't read survive into the
// emitted output unchanged; doctor reports them via unknownClaudeHookFields.
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

/** Hook handler types Claude Code runs. */
export const CLAUDE_HANDLER_TYPES: ReadonlySet<string> = new Set(Object.keys(claudeHandlerSchemas));

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

const CLAUDE_HANDLER_SCHEMAS = new Map<string, z.ZodObject>(Object.entries(claudeHandlerSchemas));

/** Validate one handler object against Claude Code's schema for its `type`. */
export function claudeHandlerProblems(handler: Record<string, unknown>): HandlerProblem[] {
  const type = handlerType(handler);
  const schema = CLAUDE_HANDLER_SCHEMAS.get(type);
  if (!schema) return [{ path: ['type'], message: `unknown handler type \`${type}\`` }];

  return schemaProblems(schema, handler);
}

/** Fields of a Claude handler object that Claude Code does not read. */
export function unknownClaudeHandlerFields(handler: Record<string, unknown>): string[] {
  const schema = CLAUDE_HANDLER_SCHEMAS.get(handlerType(handler));
  if (!schema) return [];

  return Object.keys(handler).filter((field) => !(field in schema.shape));
}

// Codex 0.160.0's hook handler schema (verified October 2026 against
// hook_config.rs and discovery.rs at rust-v0.160.0). Handlers are loose
// because Codex ignores unknown handler keys; doctor reports them. `prompt`
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

/** Hook handler types Codex parses, whether or not it runs them. */
export const CODEX_HANDLER_TYPES: ReadonlySet<string> = new Set(Object.keys(codexHandlerSchemas));

/** Handler types Codex parses and then skips with a load-failure warning. */
export const CODEX_SKIPPED_HANDLER_TYPES: ReadonlySet<string> = new Set(['prompt', 'agent']);

/** Whether Codex actually runs a handler type. */
export function codexRunsHandlerType(type: string): boolean {
  return CODEX_HANDLER_TYPES.has(type) && !CODEX_SKIPPED_HANDLER_TYPES.has(type);
}

/** Whether Claude Code runs a handler type. */
export function claudeRunsHandlerType(type: string): boolean {
  return CLAUDE_HANDLER_TYPES.has(type);
}

const CODEX_HANDLER_SCHEMAS = new Map<string, z.ZodObject>(Object.entries(codexHandlerSchemas));

/** Validate one handler object against Codex's schema for its `type`. */
export function codexHandlerProblems(handler: Record<string, unknown>): HandlerProblem[] {
  const schema = CODEX_HANDLER_SCHEMAS.get(handlerType(handler));

  return schema ? schemaProblems(schema, handler) : [];
}

/** Fields of a Codex handler object that Codex does not read. */
export function unknownCodexHandlerFields(handler: Record<string, unknown>): string[] {
  const type = handlerType(handler);
  const schema = CODEX_HANDLER_SCHEMAS.get(type);
  // A skipped handler never runs, so its fields are not worth reporting one by one.
  if (!schema || CODEX_SKIPPED_HANDLER_TYPES.has(type)) return [];

  return Object.keys(handler).filter((field) => !(field in schema.shape));
}

// An unrecognised `type` is not a schema error: Codex most likely rejects it
// (an internally tagged enum), but that is inferred rather than verified, so
// doctor raises a hedged warning instead.
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

const CODEX_GROUP_FIELDS = new Set(Object.keys(codexMatcherGroupSchema.shape));

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

/** What doctor can say about a Codex hook settings table beyond its schema. */
export type CodexHookFindings = {
  /** Paths of fields or events Codex does not read. */
  unknownFields: string[];
  /** Paths of handlers whose `type` Codex does not recognise. */
  unknownTypes: string[];
  /** Paths of `prompt` and `agent` handlers, which Codex parses and skips. */
  skippedHandlers: string[];
};

const codexMatcherGroupsSchema = z.array(codexMatcherGroupSchema);

function handlerFindings(
  handler: { type: string },
  path: string,
  findings: CodexHookFindings,
): void {
  if (!CODEX_HANDLER_TYPES.has(handler.type)) findings.unknownTypes.push(path);
  if (CODEX_SKIPPED_HANDLER_TYPES.has(handler.type)) findings.skippedHandlers.push(path);
  for (const field of unknownCodexHandlerFields(handler)) {
    findings.unknownFields.push(`${path}.${field}`);
  }
}

function groupFindings(
  group: z.infer<typeof codexMatcherGroupSchema>,
  path: string,
  findings: CodexHookFindings,
): void {
  for (const field of Object.keys(group)) {
    if (!CODEX_GROUP_FIELDS.has(field)) findings.unknownFields.push(`${path}.${field}`);
  }
  for (const [index, handler] of (group.hooks ?? []).entries()) {
    handlerFindings(handler, `${path}.hooks[${index}]`, findings);
  }
}

/** Walk a Codex hook settings table for fields and handlers Codex ignores or skips. */
export function codexHookFindings(settings: CodexHookSettings): CodexHookFindings {
  const findings: CodexHookFindings = { unknownFields: [], unknownTypes: [], skippedHandlers: [] };

  for (const [key, value] of Object.entries(settings)) {
    if (!CODEX_HOOK_EVENTS.has(key)) {
      if (key !== 'state') findings.unknownFields.push(`hooks.${key}`);
      continue;
    }

    // Already validated by the settings schema; parsing again only narrows the type.
    for (const [index, group] of codexMatcherGroupsSchema.parse(value).entries()) {
      groupFindings(group, `hooks.${key}[${index}]`, findings);
    }
  }

  return findings;
}
