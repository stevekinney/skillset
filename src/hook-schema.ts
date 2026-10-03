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
