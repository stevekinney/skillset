import { describe, expect, it } from 'bun:test';

import {
  claudeAgentFrontmatterSchema,
  codexAgentSchema,
  parseClaudeAgentMapping,
} from './agent-frontmatter.js';

const full = {
  name: 'reviewer',
  description: 'Reviews diffs.',
  tools: 'Read, Grep, Bash',
  disallowedTools: 'Write',
  model: 'haiku',
  permissionMode: 'plan',
  maxTurns: 10,
  skills: ['code-style'],
  mcpServers: ['codex'],
  hooks: { PreToolUse: [] },
  memory: 'user',
  background: true,
  effort: 'low',
  isolation: 'worktree',
  color: 'cyan',
  initialPrompt: 'Review the diff.',
};

const minimal = { name: 'a', description: 'b' };

describe('claudeAgentFrontmatterSchema', () => {
  it('parses every documented field and requires name and description', () => {
    expect(claudeAgentFrontmatterSchema.parse(full) as unknown).toEqual(full);
    expect(() => claudeAgentFrontmatterSchema.parse({ name: 'a' })).toThrow();
    expect(() => claudeAgentFrontmatterSchema.parse({ description: 'b' })).toThrow();
  });

  it('rejects invalid enums', () => {
    expect(() => claudeAgentFrontmatterSchema.parse({ ...minimal, color: 'mauve' })).toThrow();
    expect(() =>
      claudeAgentFrontmatterSchema.parse({ ...minimal, permissionMode: 'yolo' }),
    ).toThrow();
  });

  it('accepts the fields added since Claude Code 2.1.221', () => {
    const extra = {
      omitClaudeMd: true,
      experimental: { cacheTtl: '1h' },
      isolation: 'remote',
      effort: 4000,
    };
    expect(claudeAgentFrontmatterSchema.parse({ ...minimal, ...extra }) as unknown).toEqual({
      ...minimal,
      ...extra,
    });
    expect(() =>
      claudeAgentFrontmatterSchema.parse({ ...minimal, experimental: { cacheTtl: '2h' } }),
    ).toThrow();
    expect(() =>
      claudeAgentFrontmatterSchema.parse({ ...minimal, isolation: 'container' }),
    ).toThrow();
  });

  it('accepts only true/false spellings for background', () => {
    expect(claudeAgentFrontmatterSchema.parse({ ...minimal, background: 'false' }).background).toBe(
      false,
    );
    expect(claudeAgentFrontmatterSchema.parse({ ...minimal, background: 'true' }).background).toBe(
      true,
    );
    expect(() => claudeAgentFrontmatterSchema.parse({ ...minimal, background: 'yes' })).toThrow();
  });

  it('accepts the undocumented observer fields', () => {
    const observer = {
      observer: 'auditor',
      observerMessage: 'Watch for drift.',
      observeSubagents: 'false',
    };
    expect(claudeAgentFrontmatterSchema.parse({ ...minimal, ...observer })).toEqual({
      ...minimal,
      ...observer,
      observeSubagents: false,
    });
    expect(() => claudeAgentFrontmatterSchema.parse({ ...minimal, observer: '' })).toThrow();
  });

  it('accepts server names and inline entries, and keeps items Claude Code would drop', () => {
    const mcpServers = ['github', { playwright: { type: 'stdio', command: 'npx' } }, 5];
    expect(claudeAgentFrontmatterSchema.parse({ ...minimal, mcpServers }).mcpServers).toEqual(
      mcpServers,
    );
  });
});

describe('parseClaudeAgentMapping', () => {
  it('collects keys Claude Code does not read and keeps the body', () => {
    const parsed = parseClaudeAgentMapping({ ...minimal, codex: {}, sparkle: 1 }, 'You review.');
    expect(parsed.unknownKeys).toEqual(['codex', 'sparkle']);
    expect(parsed.frontmatter).toEqual(minimal);
    expect(parsed.body).toBe('You review.');
  });
});

describe('codexAgentSchema', () => {
  const required = { name: 'reviewer', description: 'Reviews.', developer_instructions: 'Review.' };

  it('requires name, description, and developer_instructions', () => {
    expect(codexAgentSchema.parse(required)).toEqual(required);
    for (const key of Object.keys(required)) {
      const { [key]: _omitted, ...rest } = required as Record<string, string>;
      expect(codexAgentSchema.safeParse(rest).success).toBe(false);
    }
  });

  it('keeps any other config.toml key', () => {
    expect(codexAgentSchema.parse({ ...required, approval_policy: 'never' })).toEqual({
      ...required,
      approval_policy: 'never',
    });
  });

  it('validates the verbosity, reasoning, and nickname fields like Codex does', () => {
    expect(codexAgentSchema.parse({ ...required, model_verbosity: 'low' }).model_verbosity).toBe(
      'low',
    );
    expect(() => codexAgentSchema.parse({ ...required, model_verbosity: 'loud' })).toThrow();
    expect(() => codexAgentSchema.parse({ ...required, model_reasoning_effort: '' })).toThrow();

    expect(
      codexAgentSchema.parse({ ...required, nickname_candidates: ['Scout', 'Field_Agent-2'] })
        .nickname_candidates,
    ).toEqual(['Scout', 'Field_Agent-2']);
    for (const invalid of [[], ['  '], ['Scout', ' Scout '], ['Scout!']]) {
      expect(() => codexAgentSchema.parse({ ...required, nickname_candidates: invalid })).toThrow();
    }
  });

  it('types mcp_servers with the Codex schema', () => {
    expect(
      codexAgentSchema.parse({
        ...required,
        mcp_servers: { docs: { url: 'https://x', startup_readiness: 'catalog' } },
      }).mcp_servers?.['docs']?.url,
    ).toBe('https://x');
    expect(() =>
      codexAgentSchema.parse({ ...required, mcp_servers: { docs: { command: 'x', url: 'y' } } }),
    ).toThrow();
  });
});
