import { parseArgs } from 'node:util';

import type { SourceKind } from './commands.js';
import type { Target } from './frontmatter.js';
import type { ImportKind } from './import.js';
import type { Scope } from './targets.js';

/** The `--kind` sync filter values. */
export type KindFilter = 'skills' | 'agents' | 'mcp' | 'instructions' | 'hooks' | 'defaults';

/** A fully parsed and validated CLI invocation. */
export type Invocation = {
  command: 'sync' | 'doctor' | 'list' | 'show' | 'new' | 'remove' | 'get' | 'set' | 'import';
  dryRun: boolean;
  prune: boolean;
  force: boolean;
  json: boolean;
  /** `doctor --targets`: check managed outputs for drift instead of sources. */
  checkTargets: boolean;
  scope: Scope;
  targets: Target[];
  /** `sync` scope filter. */
  kind?: KindFilter;
  /** CRUD source kind (`new`/`remove`/`get`/`set`). */
  sourceKind?: SourceKind;
  /** Import kind (`import`). */
  importKind?: ImportKind;
  /** The tool an import reads from. */
  from?: Target;
  /** CRUD source name (`show`/`new`/`remove`/`get`/`set`/`import`). */
  name?: string;
  /** Frontmatter dot path (`get`/`set`). */
  fieldPath?: string;
  /** YAML-parsed value (`set`). */
  value?: string;
};

export const USAGE = `Usage:
  skillset [sync] [--dry-run] [--prune] [--force] [--scope user|project] [--target claude|codex] [--kind <kind>] [--json]
  skillset doctor [--targets] [--scope user|project] [--json]
  skillset list [--json]
  skillset show <name> [--target claude|codex] [--json]
  skillset new <skill|agent> <name>
  skillset remove <skill|agent> <name>
  skillset get <skill|agent> <name> [<field-path>] [--json]
  skillset set <skill|agent> <name> <field-path> <value>
  skillset import <skill|agent|instructions> [name] [--from claude|codex] [--scope user|project]

Compiles the skills, agents, MCP servers, instructions, hooks, and defaults
in the current directory (or $SKILLSET_DIRECTORY) into Claude Code's and
Codex's formats.

Options:
  --dry-run   Print the sync plan without touching disk.
  --prune     Remove previously generated outputs that no longer exist in source.
  --force     Overwrite targets that skillset did not generate or that drifted.
  --scope     Write into the home directory (user, default) or this repo (project).
  --target    Limit to one tool.
  --kind      Limit sync to one source kind (skills|agents|mcp|instructions|hooks|defaults).
  --targets   With doctor: check managed outputs for drift instead of sources.
  --from      With import: which tool to read from (default claude).
  --json      Machine-readable output.
  -h, --help  Show this help.`;

const COMMANDS = [
  'sync',
  'doctor',
  'list',
  'show',
  'new',
  'remove',
  'get',
  'set',
  'import',
] as const;

function isCommand(value: string): value is Invocation['command'] {
  return (COMMANDS as readonly string[]).includes(value);
}

function usageError(message: string): { usageError: string } {
  return { usageError: message };
}

function parseSourceKind(value: string | undefined): SourceKind | { usageError: string } {
  if (value === 'skill' || value === 'agent') return value;

  return usageError(`expected \`skill\` or \`agent\`, got \`${value ?? '(nothing)'}\``);
}

function parseSkillsetArguments(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      prune: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      targets: { type: 'boolean', default: false },
      target: { type: 'string' },
      kind: { type: 'string' },
      scope: { type: 'string' },
      from: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

function validateTarget(target: string | undefined): Target | undefined | { usageError: string } {
  if (target === undefined || target === 'claude' || target === 'codex') return target;

  return usageError(`--target expects \`claude\` or \`codex\`, got \`${target}\``);
}

const KIND_FILTERS: readonly KindFilter[] = [
  'skills',
  'agents',
  'mcp',
  'instructions',
  'hooks',
  'defaults',
];

function isKindFilter(value: string): value is KindFilter {
  return (KIND_FILTERS as readonly string[]).includes(value);
}

function validateKind(kind: string | undefined): KindFilter | undefined | { usageError: string } {
  if (kind === undefined || isKindFilter(kind)) return kind;

  return usageError(`--kind expects one of ${KIND_FILTERS.join('|')}, got \`${kind}\``);
}

function validateScope(scope: string | undefined): Scope | { usageError: string } {
  if (scope === undefined) return 'user';
  if (scope === 'user' || scope === 'project') return scope;

  return usageError(`--scope expects \`user\` or \`project\`, got \`${scope}\``);
}

function validateFrom(from: string | undefined): Target | undefined | { usageError: string } {
  if (from === undefined || from === 'claude' || from === 'codex') return from;

  return usageError(`--from expects \`claude\` or \`codex\`, got \`${from}\``);
}

function assignKindAndName(
  invocation: Invocation,
  rest: string[],
): { usageError: string } | undefined {
  const sourceKind = parseSourceKind(rest[0]);
  if (typeof sourceKind !== 'string') return sourceKind;

  invocation.sourceKind = sourceKind;
  invocation.name = rest[1]!;

  return undefined;
}

function assignPositionals(
  invocation: Invocation,
  rest: string[],
): { usageError: string } | undefined {
  switch (invocation.command) {
    case 'show': {
      if (rest.length !== 1) return usageError('show expects exactly one <name>');
      invocation.name = rest[0]!;

      return undefined;
    }
    case 'new':
    case 'remove': {
      if (rest.length !== 2)
        return usageError(`${invocation.command} expects <skill|agent> <name>`);

      return assignKindAndName(invocation, rest);
    }
    case 'get':
      return assignGetPositionals(invocation, rest);
    case 'set':
      return assignSetPositionals(invocation, rest);
    case 'import':
      return assignImportPositionals(invocation, rest);
    default:
      return undefined;
  }
}

function assignImportPositionals(
  invocation: Invocation,
  rest: string[],
): { usageError: string } | undefined {
  const kind = rest[0];
  if (kind !== 'skill' && kind !== 'agent' && kind !== 'instructions') {
    return usageError(`import expects <skill|agent|instructions>, got \`${kind ?? '(nothing)'}\``);
  }

  invocation.importKind = kind;

  if (kind === 'instructions') {
    if (rest.length > 1) return usageError('import instructions takes no <name>');

    return undefined;
  }

  if (rest.length !== 2) return usageError(`import ${kind} expects a <name>`);
  invocation.name = rest[1]!;

  return undefined;
}

function assignGetPositionals(
  invocation: Invocation,
  rest: string[],
): { usageError: string } | undefined {
  if (rest.length < 2 || rest.length > 3) {
    return usageError('get expects <skill|agent> <name> [<field-path>]');
  }

  const failure = assignKindAndName(invocation, rest);
  if (failure) return failure;
  if (rest[2] !== undefined) invocation.fieldPath = rest[2];

  return undefined;
}

function assignSetPositionals(
  invocation: Invocation,
  rest: string[],
): { usageError: string } | undefined {
  if (rest.length !== 4) {
    return usageError('set expects <skill|agent> <name> <field-path> <value>');
  }

  const failure = assignKindAndName(invocation, rest);
  if (failure) return failure;
  invocation.fieldPath = rest[2]!;
  invocation.value = rest[3]!;

  return undefined;
}

type ValidatedFlags = {
  target: Target | undefined;
  kind: KindFilter | undefined;
  scope: Scope;
  from: Target | undefined;
};

function validateFlags(
  values: ReturnType<typeof parseSkillsetArguments>['values'],
): ValidatedFlags | { usageError: string } {
  const target = validateTarget(values.target);
  if (typeof target === 'object') return target;

  const kind = validateKind(values.kind);
  if (typeof kind === 'object') return kind;

  const scope = validateScope(values.scope);
  if (typeof scope === 'object') return scope;

  const from = validateFrom(values.from);
  if (typeof from === 'object') return from;

  return { target, kind, scope, from };
}

function buildInvocation(
  command: Invocation['command'],
  values: ReturnType<typeof parseSkillsetArguments>['values'],
  flags: ValidatedFlags,
): Invocation {
  const invocation: Invocation = {
    command,
    dryRun: values['dry-run'],
    prune: values.prune,
    force: values.force,
    json: values.json,
    checkTargets: values.targets,
    scope: flags.scope,
    targets: flags.target ? [flags.target] : ['claude', 'codex'],
  };
  if (flags.kind !== undefined) invocation.kind = flags.kind;
  if (flags.from !== undefined) invocation.from = flags.from;

  return invocation;
}

/** Parse and validate argv into an {@link Invocation} or a usage error. */
export function parseInvocation(argv: string[]): Invocation | { usageError: string } {
  let parsed: ReturnType<typeof parseSkillsetArguments>;
  try {
    parsed = parseSkillsetArguments(argv);
  } catch (cause) {
    return usageError(cause instanceof Error ? cause.message : String(cause));
  }

  const { values, positionals } = parsed;
  if (values.help) return usageError('');

  const command = positionals[0] ?? 'sync';
  if (!isCommand(command)) return usageError(`unknown command \`${command}\``);

  const flags = validateFlags(values);
  if ('usageError' in flags) return flags;

  const invocation = buildInvocation(command, values, flags);

  return assignPositionals(invocation, positionals.slice(1)) ?? invocation;
}
