import { parse, stringify } from 'yaml';
import { z } from 'zod';

/** The two tools this package compiles skills for. */
export type Target = 'claude' | 'codex';

const stringOrStringList = z.union([z.string(), z.array(z.string())]);

const openaiInterfaceSchema = z.object({
  display_name: z.string().optional(),
  short_description: z.string().optional(),
  icon_small: z.string().optional(),
  icon_large: z.string().optional(),
  brand_color: z.string().optional(),
  default_prompt: z.string().optional(),
});

const openaiToolDependencySchema = z.object({
  type: z.string(),
  value: z.string(),
  description: z.string().optional(),
  transport: z.string().optional(),
  url: z.string().optional(),
});

const openaiSchema = z.object({
  interface: openaiInterfaceSchema.optional(),
  policy: z.object({ allow_implicit_invocation: z.boolean().optional() }).optional(),
  dependencies: z.object({ tools: z.array(openaiToolDependencySchema).optional() }).optional(),
});

/**
 * The union of every frontmatter field either tool understands.
 *
 * Shared fields come from the agentskills.io spec and are emitted for both
 * targets. The Claude-only fields are emitted only into the Claude output.
 * The `openai` block is Codex-only and is emitted as `agents/openai.yaml`
 * rather than as SKILL.md frontmatter.
 */
export const skillFrontmatterSchema = z.object({
  // Shared (agentskills.io spec).
  name: z.string(),
  description: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  'allowed-tools': stringOrStringList.optional(),

  // Claude Code only.
  when_to_use: z.string().optional(),
  'argument-hint': z.string().optional(),
  arguments: stringOrStringList.optional(),
  'disable-model-invocation': z.boolean().optional(),
  'user-invocable': z.boolean().optional(),
  'disallowed-tools': stringOrStringList.optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  context: z.string().optional(),
  agent: z.string().optional(),
  background: z.boolean().optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
  paths: stringOrStringList.optional(),
  shell: z.enum(['bash', 'powershell']).optional(),

  // Codex only — compiled to agents/openai.yaml.
  openai: openaiSchema.optional(),
});

/** A validated union frontmatter block. */
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/** The shape of an emitted `agents/openai.yaml` file. */
export type OpenaiConfiguration = z.infer<typeof openaiSchema>;

const CLAUDE_ONLY_KEYS = [
  'when_to_use',
  'argument-hint',
  'disable-model-invocation',
  'user-invocable',
  'disallowed-tools',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'hooks',
  'paths',
  'shell',
] as const;

// `name`/`description` are required by both tools; `arguments`/`allowed-tools`
// are documented by both; `license`/`compatibility`/`metadata` come from the
// agentskills.io spec (Claude Code ignores unknown keys, so they are harmless
// there and meaningful to spec-following tools).
const SHARED_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'arguments',
  'allowed-tools',
] as const;

const KNOWN_KEYS = new Set<string>([...SHARED_KEYS, ...CLAUDE_ONLY_KEYS, 'openai']);

/** A SKILL.md file split into its frontmatter and markdown body. */
export type ParsedSkillFile = {
  frontmatter: SkillFrontmatter;
  /** Top-level frontmatter keys neither tool understands. */
  unknownKeys: string[];
  /** The markdown body after the closing frontmatter fence. */
  body: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split any frontmatter-bearing markdown file into its raw YAML mapping and
 * body. Shared by the skill and agent parsers.
 *
 * @throws {Error} If the frontmatter fence is missing or the YAML is not a mapping.
 */
export function splitFrontmatter(raw: string): { mapping: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) throw new Error('missing YAML frontmatter (expected a leading `---` block)');

  const parsed: unknown = parse(match[1]!);
  if (!isMapping(parsed)) throw new Error('frontmatter must be a YAML mapping');

  return { mapping: parsed, body: raw.slice(match[0].length) };
}

/** Narrow an unknown value to a plain string-keyed mapping. */
export function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a raw SKILL.md file into validated frontmatter and a markdown body.
 *
 * @throws {Error} If the frontmatter fence is missing or the YAML is malformed.
 * @throws {z.ZodError} If the frontmatter fails the union schema.
 */
export function parseSkillFile(raw: string): ParsedSkillFile {
  const { mapping, body } = splitFrontmatter(raw);

  const frontmatter = skillFrontmatterSchema.parse(mapping);
  const unknownKeys = Object.keys(mapping).filter((key) => !KNOWN_KEYS.has(key));

  return { frontmatter, unknownKeys, body };
}

function pick(frontmatter: SkillFrontmatter, keys: readonly string[]): Record<string, unknown> {
  const record = frontmatter as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    if (record[key] !== undefined) result[key] = record[key];
  }

  return result;
}

/** Project the union frontmatter onto the fields Claude Code understands. */
export function claudeFrontmatter(frontmatter: SkillFrontmatter): Record<string, unknown> {
  return pick(frontmatter, [...SHARED_KEYS, ...CLAUDE_ONLY_KEYS]);
}

/** Project the union frontmatter onto the fields Codex understands. */
export function codexFrontmatter(frontmatter: SkillFrontmatter): Record<string, unknown> {
  return pick(frontmatter, SHARED_KEYS);
}

/**
 * Build the `agents/openai.yaml` contents for the Codex output.
 *
 * `disable-model-invocation: true` implies `policy.allow_implicit_invocation:
 * false` (the closest Codex equivalent) unless the author set an explicit
 * `openai.policy`, which always wins. Returns `undefined` when there is
 * nothing to emit.
 */
export function openaiConfiguration(
  frontmatter: SkillFrontmatter,
): OpenaiConfiguration | undefined {
  const explicit = frontmatter.openai ?? {};
  const policy =
    explicit.policy ??
    (frontmatter['disable-model-invocation'] ? { allow_implicit_invocation: false } : undefined);

  const configuration: OpenaiConfiguration = {};
  if (explicit.interface) configuration.interface = explicit.interface;
  if (policy) configuration.policy = policy;
  if (explicit.dependencies) configuration.dependencies = explicit.dependencies;

  if (Object.keys(configuration).length === 0) return undefined;

  return configuration;
}

/** Serialize a frontmatter projection back to a fenced YAML block. */
export function serializeFrontmatter(fields: Record<string, unknown>): string {
  return `---\n${stringify(fields)}---\n`;
}

/** Serialize an `agents/openai.yaml` configuration to YAML. */
export function serializeOpenaiConfiguration(configuration: OpenaiConfiguration): string {
  return stringify(configuration);
}
