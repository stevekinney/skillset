import { z } from 'zod';

import { claudeHookSettingsSchema } from './hook-schema.js';

/** The two tools this package describes. */
export type Target = 'claude' | 'codex';

const stringOrStringList = z.union([z.string(), z.array(z.string())]);

const CLAUDE_TRUE_SPELLINGS = new Set(['1', 'true', 'yes', 'on']);
const CLAUDE_FALSE_SPELLINGS = new Set(['0', 'false', 'no', 'off']);

/**
 * A skill boolean as Claude Code reads it (2.1.218+): a native boolean or
 * `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`, trimmed and
 * case-insensitive. Normalized to a real boolean.
 */
const claudeSkillBoolean = z.preprocess((value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return value;

  const spelling = String(value).trim().toLowerCase();
  if (CLAUDE_TRUE_SPELLINGS.has(spelling)) return true;
  if (CLAUDE_FALSE_SPELLINGS.has(spelling)) return false;

  return value;
}, z.boolean());

/** Claude Code effort: a named level or an integer budget. */
export const claudeEffortSchema = z.union([
  z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  z.number().int(),
]);
/** A Claude Code skill or subagent `effort` value. */
export type ClaudeEffort = z.infer<typeof claudeEffortSchema>;

/**
 * Claude Code settings.json `effortLevel`: exactly these four. An invalid value
 * is silently unset, and `max`, integers, and `ultracode` are rejected — a
 * different set from skill and subagent `effort`.
 */
export const claudeSettingsEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
/** A Claude Code settings.json `effortLevel` value. */
export type ClaudeSettingsEffort = z.infer<typeof claudeSettingsEffortSchema>;

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
  command: z.string().optional(),
  oauth: z
    .object({
      callbackPort: z.number().int().min(1).max(65_535).optional(),
      callback_port: z.number().int().min(1).max(65_535).optional(),
    })
    .optional(),
});

/** The `agents/openai.yaml` file Codex reads beside a SKILL.md. */
export const openaiConfigurationSchema = z.object({
  interface: openaiInterfaceSchema.optional(),
  policy: z
    .object({
      allow_implicit_invocation: z.boolean().optional(),
      // Codex's `Product` enum also declares uppercase aliases.
      products: z
        .array(z.enum(['chatgpt', 'codex', 'atlas', 'CHATGPT', 'CODEX', 'ATLAS']))
        .optional(),
    })
    .optional(),
  dependencies: z.object({ tools: z.array(openaiToolDependencySchema).optional() }).optional(),
});
/** The shape of an `agents/openai.yaml` file. */
export type OpenaiConfiguration = z.infer<typeof openaiConfigurationSchema>;

/**
 * Fields from the agentskills.io spec. Claude Code ignores the ones it does not
 * document and Codex tolerates them, so both schemas accept them.
 */
const specFields = {
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  'allowed-tools': stringOrStringList.optional(),
  arguments: stringOrStringList.optional(),
};

/**
 * SKILL.md frontmatter as Claude Code reads it. Every field is optional: `name`
 * defaults to the skill's directory name, and `description` is recommended but
 * not required.
 */
export const claudeSkillFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  ...specFields,
  when_to_use: z.string().optional(),
  'argument-hint': z.string().optional(),
  'disable-model-invocation': claudeSkillBoolean.optional(),
  'user-invocable': claudeSkillBoolean.optional(),
  'disallowed-tools': stringOrStringList.optional(),
  // Undocumented alias Claude Code's own schema accepts for `disallowed-tools`.
  disallowedTools: stringOrStringList.optional(),
  model: z.string().optional(),
  effort: claudeEffortSchema.optional(),
  context: z.enum(['inline', 'fork']).optional(),
  agent: z.string().optional(),
  background: claudeSkillBoolean.optional(),
  hooks: claudeHookSettingsSchema.optional(),
  paths: stringOrStringList.optional(),
  shell: z.enum(['bash', 'powershell']).optional(),
});
/** Validated Claude Code SKILL.md frontmatter. */
export type ClaudeSkillFrontmatter = z.infer<typeof claudeSkillFrontmatterSchema>;

/**
 * SKILL.md frontmatter as Codex reads it. `name` and `description` are
 * required. Codex consumes only those two and `metadata.short-description`;
 * other keys are tolerated.
 */
export const codexSkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  ...specFields,
});
/** Validated Codex SKILL.md frontmatter. */
export type CodexSkillFrontmatter = z.infer<typeof codexSkillFrontmatterSchema>;

/**
 * Keys a SKILL.md may carry without a warning. One SKILL.md is often shared by
 * both tools, so Claude's keys count as known for Codex too; a key neither tool
 * reads is unknown for both.
 */
const KNOWN_SKILL_KEYS = new Set<string>(Object.keys(claudeSkillFrontmatterSchema.shape));

/** A SKILL.md file split into validated frontmatter and its markdown body. */
export type ParsedSkillFile<Frontmatter = ClaudeSkillFrontmatter> = {
  frontmatter: Frontmatter;
  /** Top-level frontmatter keys neither tool reads. */
  unknownKeys: string[];
  /** The markdown body after the closing frontmatter fence. */
  body: string;
};

/** Narrow an unknown value to a plain string-keyed mapping. */
export function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownSkillKeys(mapping: Record<string, unknown>): string[] {
  return Object.keys(mapping).filter((key) => !KNOWN_SKILL_KEYS.has(key));
}

/**
 * Validate a parsed frontmatter mapping as Claude Code's SKILL.md frontmatter.
 *
 * @throws {z.ZodError} If the mapping fails the schema.
 */
export function parseClaudeSkillMapping(
  mapping: Record<string, unknown>,
  body: string,
): ParsedSkillFile {
  const frontmatter = claudeSkillFrontmatterSchema.parse(mapping);

  return { frontmatter, unknownKeys: unknownSkillKeys(mapping), body };
}

/**
 * Validate a parsed frontmatter mapping as Codex's SKILL.md frontmatter.
 *
 * @throws {z.ZodError} If the mapping fails the schema.
 */
export function parseCodexSkillMapping(
  mapping: Record<string, unknown>,
  body: string,
): ParsedSkillFile<CodexSkillFrontmatter> {
  const frontmatter = codexSkillFrontmatterSchema.parse(mapping);

  return { frontmatter, unknownKeys: unknownSkillKeys(mapping), body };
}
