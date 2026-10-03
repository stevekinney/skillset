import { parse } from 'yaml';
import { z } from 'zod';

import type { Issue } from './doctor.js';
import { isMapping, type Target } from './frontmatter.js';
import {
  CLAUDE_HOOK_EVENTS,
  CODEX_HANDLER_TYPES,
  CODEX_HOOK_EVENTS,
  claudeHandlerProblems,
  claudeRunsHandlerType,
  codexHandlerProblems,
  codexRunsHandlerType,
  supportsHookEvent,
  unknownClaudeHandlerFields,
  unknownCodexHandlerFields,
  type HandlerProblem,
} from './hook-schema.js';

const sharedFields = {
  matcher: z.string().optional(),
  /** Seconds, in both tools. */
  timeout: z.number().int().positive().optional(),
  statusMessage: z.string().optional(),
  targets: z.array(z.enum(['claude', 'codex'])).optional(),
  /** Per-target handler-object overrides, merged last. */
  claude: z.record(z.string(), z.unknown()).optional(),
  codex: z.record(z.string(), z.unknown()).optional(),
};

// One variant per handler type. A definition without `type` is a command hook,
// so every hooks.yaml written before other types existed keeps working. The
// per-target handler each variant produces is validated against that target's
// own schema by doctor (see checkHandler).
const hookVariants = [
  z.object({ type: z.literal('command'), command: z.string(), ...sharedFields }),
  z.object({
    type: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    allowedEnvVars: z.array(z.string()).optional(),
    ...sharedFields,
  }),
  z.object({
    type: z.literal('mcp_tool'),
    server: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()).optional(),
    ...sharedFields,
  }),
  z.object({
    type: z.literal('prompt'),
    prompt: z.string(),
    model: z.string().optional(),
    ...sharedFields,
  }),
  z.object({
    type: z.literal('agent'),
    prompt: z.string(),
    model: z.string().optional(),
    ...sharedFields,
  }),
] as const;

const hookSchema = z.preprocess(
  (value) =>
    isMapping(value) && value['type'] === undefined ? { ...value, type: 'command' } : value,
  z.discriminatedUnion('type', hookVariants),
);

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

const ENTRY_LEVEL_FIELDS = new Set(['matcher', 'targets', 'claude', 'codex']);

/**
 * The handler object one target receives: the definition's handler fields
 * (everything but the entry-level `matcher`, `targets`, and override blocks)
 * with the per-target override object merged in last.
 */
export function hookHandler(definition: HookDefinition, target: Target): Record<string, unknown> {
  const handler = Object.fromEntries(
    Object.entries(definition).filter(([key]) => !ENTRY_LEVEL_FIELDS.has(key)),
  );

  return { ...handler, ...(target === 'claude' ? definition.claude : definition.codex) };
}

/**
 * Build the config entry for one hook definition and target — the shared
 * `{matcher?, hooks: [handler]}` shape both tools use.
 */
export function hookEntry(definition: HookDefinition, target: Target): Record<string, unknown> {
  const entry: Record<string, unknown> = { hooks: [hookHandler(definition, target)] };
  if (definition.matcher !== undefined) entry['matcher'] = definition.matcher;

  return entry;
}

/** A stable ledger name for one hook definition. */
export function hookName(event: string, definition: HookDefinition, index: number): string {
  return `${event}/${definition.matcher ?? '*'}/${index}`;
}

const TARGET_NAMES = { claude: 'Claude', codex: 'Codex' } as const;

/** A short name for a hook in doctor messages: its command, URL, tool, or prompt. */
function hookLabel(definition: HookDefinition): string {
  switch (definition.type) {
    case 'command':
      return definition.command;
    case 'http':
      return definition.url;
    case 'mcp_tool':
      return `${definition.server}/${definition.tool}`;
    default:
      return definition.prompt;
  }
}

function describeProblem(problem: HandlerProblem): string {
  const location = problem.path.join('.');

  return location ? `\`${location}\`: ${problem.message}` : problem.message;
}

function onlyTargetsHint(target: Target): string {
  const other = target === 'claude' ? 'codex' : 'claude';

  return `add \`targets: [${other}]\``;
}

function unrunnableHandlerIssue(
  event: string,
  type: string,
  target: Target,
  label: string,
): Issue | undefined {
  const name = TARGET_NAMES[target];

  if (target === 'claude' ? !claudeRunsHandlerType(type) : !codexRunsHandlerType(type)) {
    const reason =
      CODEX_HANDLER_TYPES.has(type) && target === 'codex' ? 'is skipped' : 'is not run';

    return {
      severity: 'error',
      message: `handler type \`${type}\` ${reason} by ${name} — ${onlyTargetsHint(target)} to the \`${label}\` hook`,
    };
  }

  if (target === 'codex' && type === 'mcp_tool' && event === 'SessionEnd') {
    return {
      severity: 'error',
      message: `Codex does not run \`mcp_tool\` handlers on \`SessionEnd\` — ${onlyTargetsHint(target)} to the \`${label}\` hook`,
    };
  }

  return undefined;
}

// Validate the handler a target will actually receive. An unrunnable type is
// one error with a `targets:` hint; a runnable one is checked field by field
// against the target's schema, and fields the target does not read warn.
function checkHandler(event: string, definition: HookDefinition, target: Target): Issue[] {
  const handler = hookHandler(definition, target);
  const type = typeof handler['type'] === 'string' ? handler['type'] : 'command';
  const label = hookLabel(definition);

  const unrunnable = unrunnableHandlerIssue(event, type, target, label);
  if (unrunnable) return [unrunnable];

  const name = TARGET_NAMES[target];
  const prefix = `hook \`${label}\` for ${name}`;
  const problems =
    target === 'claude' ? claudeHandlerProblems(handler) : codexHandlerProblems(handler);
  const unknown =
    target === 'claude' ? unknownClaudeHandlerFields(handler) : unknownCodexHandlerFields(handler);

  return [
    ...problems.map((problem): Issue => ({
      severity: 'error',
      message: `${prefix}: ${describeProblem(problem)}`,
    })),
    ...unknown.map((field): Issue => ({
      severity: 'warning',
      message: `${prefix} has unknown field \`${field}\` — ${name} ignores it`,
    })),
  ];
}

function checkDefinition(event: string, definition: HookDefinition): Issue[] {
  const issues: Issue[] = [];

  for (const target of hookTargets(definition)) {
    if (!supportsHookEvent(target, event)) {
      const [owner, ownerTarget] = target === 'codex' ? ['Claude', 'claude'] : ['Codex', 'codex'];
      issues.push({
        severity: 'error',
        message: `hook event \`${event}\` is ${owner}-only — add \`targets: [${ownerTarget}]\` to the \`${hookLabel(definition)}\` hook`,
      });
      continue;
    }

    issues.push(...checkHandler(event, definition, target));
  }

  return issues;
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

    for (const definition of definitions) issues.push(...checkDefinition(event, definition));
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
