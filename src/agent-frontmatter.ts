import { z } from 'zod';

import { claudeEffortSchema, splitFrontmatter } from './frontmatter.js';
import { codexSkillsSchema, codexToolsSchema } from './codex-agent-tables.js';
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

const codexAgentSchema = z.object({
  model: z.string().optional(),
  // Model-dependent (Codex documents it as "a non-empty reasoning effort
  // value advertised by the model"), so not an enum.
  model_reasoning_effort: z.string().min(1).optional(),
  model_verbosity: z.enum(['low', 'medium', 'high']).optional(),
  sandbox_mode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  nickname_candidates: nicknameCandidatesSchema.optional(),
  // Codex-native per-agent overrides, emitted verbatim as TOML tables. Codex
  // documents these on its subagent TOML; their schemas differ from Claude's
  // same-named frontmatter fields, so there is no automatic translation.
  hooks: codexHookSettingsSchema.optional(),
  mcp_servers: z.record(z.string(), codexMcpServerSchema).optional(),
  skills: codexSkillsSchema.optional(),
  tools: codexToolsSchema.optional(),
});

/**
 * The union of every agent frontmatter field either tool understands.
 *
 * Everything except the `codex` block is Claude Code's documented subagent
 * frontmatter. The `codex` block feeds the emitted `~/.codex/agents/<name>.toml`
 * (Codex model names are a different family, so they cannot be derived from
 * the Claude `model` field).
 */
export const agentFrontmatterSchema = z.object({
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
  // doctor warns (via claudeAgentMcpItemProblems) instead of failing the parse.
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

  // Codex only — compiled to ~/.codex/agents/<name>.toml.
  codex: codexAgentSchema.optional(),
});

/** A validated union agent frontmatter block. */
export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

const CLAUDE_AGENT_KEYS = [
  'name',
  'description',
  'tools',
  'disallowedTools',
  'model',
  'permissionMode',
  'maxTurns',
  'skills',
  'mcpServers',
  'hooks',
  'memory',
  'background',
  'effort',
  'isolation',
  'color',
  'initialPrompt',
  'omitClaudeMd',
  'experimental',
  'observer',
  'observerMessage',
  'observeSubagents',
] as const;

/** Claude fields with no documented Codex equivalent — dropped from the TOML. */
export const CODEX_DROPPED_AGENT_KEYS = [
  'maxTurns',
  'memory',
  'background',
  'isolation',
  'initialPrompt',
  'omitClaudeMd',
  'experimental',
  'observer',
  'observerMessage',
  'observeSubagents',
] as const;

/**
 * Claude fields whose Codex counterpart exists but uses a different schema
 * (Codex agent TOML has its own `hooks`/`mcp_servers`/`skills` tables) — not
 * auto-translated; the author sets the matching `codex.*` key explicitly.
 */
export const CODEX_MANUAL_AGENT_KEYS = [
  { claude: 'hooks', codex: 'hooks' },
  { claude: 'mcpServers', codex: 'mcp_servers' },
  { claude: 'skills', codex: 'skills' },
] as const;

const KNOWN_AGENT_KEYS = new Set<string>([...CLAUDE_AGENT_KEYS, 'codex']);

/** An agent .md file split into validated frontmatter and its system-prompt body. */
export type ParsedAgentFile = {
  frontmatter: AgentFrontmatter;
  /** Top-level frontmatter keys neither tool understands. */
  unknownKeys: string[];
  /** The markdown body — the agent's system prompt. */
  body: string;
};

/**
 * Parse a raw agent .md file into validated frontmatter and its body.
 *
 * @throws {Error} If the frontmatter fence is missing or the YAML is malformed.
 * @throws {z.ZodError} If the frontmatter fails the union schema.
 */
export function parseAgentFile(raw: string): ParsedAgentFile {
  const { mapping, body } = splitFrontmatter(raw);

  const frontmatter = agentFrontmatterSchema.parse(mapping);
  const unknownKeys = Object.keys(mapping).filter((key) => !KNOWN_AGENT_KEYS.has(key));

  return { frontmatter, unknownKeys, body };
}

/** Project the union frontmatter onto the fields Claude Code understands. */
export function claudeAgentFrontmatter(frontmatter: AgentFrontmatter): Record<string, unknown> {
  const record = frontmatter as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of CLAUDE_AGENT_KEYS) {
    if (record[key] !== undefined) result[key] = record[key];
  }

  return result;
}

/**
 * The `sandbox_mode` implied by a Claude `permissionMode` when the `codex`
 * block does not set one explicitly. Only `plan` and `acceptEdits` have a
 * documented mapping; other modes return `undefined` (doctor warns).
 */
export function impliedSandboxMode(
  permissionMode: AgentFrontmatter['permissionMode'],
): 'read-only' | 'workspace-write' | undefined {
  if (permissionMode === 'plan') return 'read-only';
  if (permissionMode === 'acceptEdits') return 'workspace-write';

  return undefined;
}
