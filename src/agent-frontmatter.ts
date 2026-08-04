import { z } from 'zod';

import { splitFrontmatter } from './frontmatter.js';

const stringOrStringList = z.union([z.string(), z.array(z.string())]);

const codexAgentSchema = z.object({
  model: z.string().optional(),
  model_reasoning_effort: z.string().optional(),
  model_verbosity: z.string().optional(),
  sandbox_mode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  nickname_candidates: z.array(z.string()).optional(),
  // Codex-native per-agent overrides, emitted verbatim as TOML tables. Codex
  // documents these on its subagent TOML; their schemas differ from Claude's
  // same-named frontmatter fields, so there is no automatic translation.
  hooks: z.record(z.string(), z.unknown()).optional(),
  mcp_servers: z.record(z.string(), z.unknown()).optional(),
  skills: z.record(z.string(), z.unknown()).optional(),
  tools: z.record(z.string(), z.unknown()).optional(),
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
  mcpServers: z.array(z.unknown()).optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
  memory: z.enum(['user', 'project', 'local']).optional(),
  background: z.boolean().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  isolation: z.literal('worktree').optional(),
  color: z.enum(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']).optional(),
  initialPrompt: z.string().optional(),

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
] as const;

/** Claude fields with no documented Codex equivalent — dropped from the TOML. */
export const CODEX_DROPPED_AGENT_KEYS = [
  'maxTurns',
  'memory',
  'background',
  'isolation',
  'initialPrompt',
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
