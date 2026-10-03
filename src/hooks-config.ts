import { parse } from 'yaml';
import { z } from 'zod';

import type { Issue } from './doctor.js';
import { isMapping, type Target } from './frontmatter.js';

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

const hookSchema = z.object({
  matcher: z.string().optional(),
  command: z.string(),
  /** Seconds, in both tools. */
  timeout: z.number().int().positive().optional(),
  statusMessage: z.string().optional(),
  targets: z.array(z.enum(['claude', 'codex'])).optional(),
  /** Per-target handler-object overrides, merged last. */
  claude: z.record(z.string(), z.unknown()).optional(),
  codex: z.record(z.string(), z.unknown()).optional(),
});

/** The hooks.yaml source schema. */
export const hooksSourceSchema = z.object({
  hooks: z.record(z.string(), z.array(hookSchema)),
});

/** One validated hook definition. */
export type HookDefinition = z.infer<typeof hookSchema>;

/** The validated hooks.yaml contents. */
export type HooksSource = z.infer<typeof hooksSourceSchema>;

/**
 * Parse and validate hooks.yaml.
 *
 * @throws {Error} If the YAML is malformed or fails the schema.
 */
export function parseHooksSource(raw: string): HooksSource {
  const parsed: unknown = parse(raw);
  if (!isMapping(parsed)) throw new Error('hooks.yaml must be a YAML mapping');

  return hooksSourceSchema.parse(parsed);
}

/** The targets a hook definition applies to. */
export function hookTargets(definition: HookDefinition): Target[] {
  return definition.targets ?? ['claude', 'codex'];
}

/**
 * Build the config entry for one hook definition and target — the shared
 * `{matcher?, hooks: [{type: command, …}]}` shape both tools use, with the
 * per-target override object merged into the handler last.
 */
export function hookEntry(definition: HookDefinition, target: Target): Record<string, unknown> {
  const handler: Record<string, unknown> = { type: 'command', command: definition.command };
  if (definition.timeout !== undefined) handler['timeout'] = definition.timeout;
  if (definition.statusMessage !== undefined) handler['statusMessage'] = definition.statusMessage;

  const overrides = target === 'claude' ? definition.claude : definition.codex;
  const entry: Record<string, unknown> = {
    hooks: [{ ...handler, ...overrides }],
  };
  if (definition.matcher !== undefined) entry['matcher'] = definition.matcher;

  return entry;
}

/** A stable ledger name for one hook definition. */
export function hookName(event: string, definition: HookDefinition, index: number): string {
  return `${event}/${definition.matcher ?? '*'}/${index}`;
}

/** Doctor checks for hooks.yaml. */
export function checkHooksSource(source: HooksSource): Issue[] {
  const issues: Issue[] = [];

  for (const [event, definitions] of Object.entries(source.hooks)) {
    const knownEvent = CLAUDE_HOOK_EVENTS.has(event) || CODEX_HOOK_EVENTS.has(event);
    if (!knownEvent) {
      issues.push({
        severity: 'error',
        message: `unknown hook event \`${event}\` — not a documented Claude or Codex event`,
      });
      continue;
    }

    for (const definition of definitions) {
      const unsupported = hookTargets(definition).find(
        (target) => !supportsHookEvent(target, event),
      );
      if (unsupported !== undefined) {
        const [owner, ownerTarget] =
          unsupported === 'codex' ? ['Claude', 'claude'] : ['Codex', 'codex'];
        issues.push({
          severity: 'error',
          message: `hook event \`${event}\` is ${owner}-only — add \`targets: [${ownerTarget}]\` to the \`${definition.command}\` hook`,
        });
      }
    }
  }

  if (
    Object.entries(source.hooks).some(([event, definitions]) =>
      definitions.some(
        (definition) => hookTargets(definition).includes('codex') && CODEX_HOOK_EVENTS.has(event),
      ),
    )
  ) {
    issues.push({
      severity: 'warning',
      message:
        'syncing hooks rewrites Codex hook config — Codex will require re-trusting them via /hooks',
    });
  }

  return issues;
}
