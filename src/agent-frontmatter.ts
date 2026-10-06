import { z } from 'zod';

import { codexSkillsSchema, codexToolsSchema } from './codex-agent-tables.js';
import { claudeEffortSchema } from './frontmatter.js';
import { claudeHookSettingsSchema, codexHookSettingsSchema } from './hook-schema.js';
import { codexMcpServerSchema } from './mcp-schema.js';

const stringOrStringList = z.union([z.string(), z.array(z.string())]);

/**
 * A subagent boolean as Claude Code reads it: a native boolean or the strings
 * `"true"`/`"false"`. Unlike skill booleans, `yes`/`on`/`1` are not accepted.
 */
const claudeAgentBoolean = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

/**
 * Codex's own nickname rules: a non-empty list of unique, non-blank names of
 * ASCII letters, digits, spaces, `-`, and `_`, compared after trimming.
 */
const nicknameCandidatesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .regex(/^[A-Za-z0-9 _-]+$/),
  )
  .min(1)
  .refine((names) => new Set(names).size === names.length, {
    message: 'nickname candidates must be unique',
  });

/**
 * A Claude Code subagent definition's frontmatter (`.claude/agents/<name>.md`).
 * `name` and `description` are required; the markdown body is the agent's
 * system prompt.
 */
export const claudeAgentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  tools: stringOrStringList.optional(),
  disallowedTools: stringOrStringList.optional(),
  model: z.string().optional(),
  permissionMode: z
    .enum(['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan', 'manual'])
    .optional(),
  maxTurns: z.number().int().positive().optional(),
  skills: z.array(z.string()).optional(),
  // Any item: Claude Code drops an invalid item and still loads the agent, so
  // validation warns (via claudeAgentMcpItemProblems) instead of failing the parse.
  mcpServers: z.array(z.unknown()).optional(),
  hooks: claudeHookSettingsSchema.optional(),
  memory: z.enum(['user', 'project', 'local']).optional(),
  background: claudeAgentBoolean.optional(),
  effort: claudeEffortSchema.optional(),
  isolation: z.enum(['worktree', 'remote']).optional(),
  color: z.enum(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']).optional(),
  initialPrompt: z.string().optional(),
  omitClaudeMd: claudeAgentBoolean.optional(),
  experimental: z.object({ cacheTtl: z.enum(['5m', '1h']).optional() }).optional(),
  // Undocumented but read by Claude Code 2.1.288: an agent type spawned as a
  // background observer of this agent, a postamble for its activity digests,
  // and whether subagents inherit the observer (only `false` has an effect).
  observer: z.string().trim().min(1).optional(),
  observerMessage: z.string().optional(),
  observeSubagents: claudeAgentBoolean.optional(),
});
/** Validated Claude Code subagent frontmatter. */
export type ClaudeAgentFrontmatter = z.infer<typeof claudeAgentFrontmatterSchema>;

/**
 * A Codex custom agent file (`.codex/agents/<name>.toml`), as parsed TOML.
 * `name`, `description`, and `developer_instructions` are required. The file
 * may also carry any `config.toml` key, so unknown keys are kept rather than
 * rejected. Codex 0.160 validates `mcp_servers`, `sandbox_mode`, `hooks`, and
 * `tools` here but drops them when it loads the role.
 */
export const codexAgentSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  developer_instructions: z.string(),
  model: z.string().optional(),
  // Model-dependent (Codex documents it as "a non-empty reasoning effort
  // value advertised by the model"), so not an enum.
  model_reasoning_effort: z.string().min(1).optional(),
  model_verbosity: z.enum(['low', 'medium', 'high']).optional(),
  sandbox_mode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  nickname_candidates: nicknameCandidatesSchema.optional(),
  // Codex's own per-agent tables. Their schemas match the global config.toml
  // forms, not Claude's same-named frontmatter fields.
  hooks: codexHookSettingsSchema.optional(),
  mcp_servers: z.record(z.string(), codexMcpServerSchema).optional(),
  skills: codexSkillsSchema.optional(),
  tools: codexToolsSchema.optional(),
});
/** A validated Codex custom agent file. */
export type CodexAgent = z.infer<typeof codexAgentSchema>;

const KNOWN_AGENT_KEYS = new Set<string>(Object.keys(claudeAgentFrontmatterSchema.shape));

/** A Claude Code subagent file split into validated frontmatter and its body. */
export type ParsedAgentFile = {
  frontmatter: ClaudeAgentFrontmatter;
  /** Top-level frontmatter keys Claude Code does not read. */
  unknownKeys: string[];
  /** The markdown body — the agent's system prompt. */
  body: string;
};

/**
 * Validate a parsed frontmatter mapping as Claude Code subagent frontmatter.
 *
 * @throws {z.ZodError} If the mapping fails the schema.
 */
export function parseClaudeAgentMapping(
  mapping: Record<string, unknown>,
  body: string,
): ParsedAgentFile {
  const frontmatter = claudeAgentFrontmatterSchema.parse(mapping);
  const unknownKeys = Object.keys(mapping).filter((key) => !KNOWN_AGENT_KEYS.has(key));

  return { frontmatter, unknownKeys, body };
}
