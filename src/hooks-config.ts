import { parse } from 'yaml';
import { z } from 'zod';

import type { Issue } from './doctor.js';
import { isMapping, type Target } from './frontmatter.js';
import { CLAUDE_HOOK_EVENTS, CODEX_HOOK_EVENTS, supportsHookEvent } from './hook-schema.js';

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
