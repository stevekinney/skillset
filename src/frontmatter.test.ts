import { describe, expect, it } from 'bun:test';

import {
  claudeSettingsEffortSchema,
  claudeSkillFrontmatterSchema,
  codexSkillFrontmatterSchema,
  isMapping,
  openaiConfigurationSchema,
  parseClaudeSkillMapping,
  parseCodexSkillMapping,
} from './frontmatter.js';

const full = {
  name: 'my-skill',
  description: 'Does a thing.',
  license: 'MIT',
  compatibility: 'needs git',
  metadata: { team: 'platform' },
  'allowed-tools': 'Read, Grep',
  when_to_use: 'When the thing needs doing.',
  'argument-hint': '[issue]',
  arguments: 'issue reason',
  'disable-model-invocation': true,
  'user-invocable': false,
  'disallowed-tools': 'Write',
  model: 'sonnet',
  effort: 'medium',
  context: 'fork',
  agent: 'Explore',
  background: false,
  hooks: { PostToolUse: [] },
  paths: 'src/**',
  shell: 'bash',
};

describe('claudeSkillFrontmatterSchema', () => {
  it('parses every documented field', () => {
    expect(claudeSkillFrontmatterSchema.parse(full) as unknown).toEqual(full);
  });

  it('makes every field optional, since name defaults to the directory', () => {
    expect(claudeSkillFrontmatterSchema.parse({})).toEqual({});
  });

  it('coerces the boolean spellings Claude Code accepts', () => {
    const parsed = claudeSkillFrontmatterSchema.parse({
      'disable-model-invocation': 'YES',
      'user-invocable': 'off',
      background: 1,
    });
    expect(parsed['disable-model-invocation']).toBe(true);
    expect(parsed['user-invocable']).toBe(false);
    expect(parsed.background).toBe(true);

    for (const value of ['on', ' True ', 'yes']) {
      expect(claudeSkillFrontmatterSchema.parse({ background: value }).background).toBe(true);
    }
    for (const value of ['0', 'no', 'False']) {
      expect(claudeSkillFrontmatterSchema.parse({ background: value }).background).toBe(false);
    }
    expect(() => claudeSkillFrontmatterSchema.parse({ background: 'maybe' })).toThrow();
    expect(() => claudeSkillFrontmatterSchema.parse({ background: 2 })).toThrow();
    expect(() => claudeSkillFrontmatterSchema.parse({ background: {} })).toThrow();
  });

  it('accepts integer effort and the documented context values', () => {
    expect(claudeSkillFrontmatterSchema.parse({ effort: 8000 }).effort).toBe(8000);
    expect(claudeSkillFrontmatterSchema.parse({ context: 'inline' }).context).toBe('inline');
    expect(() => claudeSkillFrontmatterSchema.parse({ context: 'forked' })).toThrow();
    expect(() => claudeSkillFrontmatterSchema.parse({ effort: 1.5 })).toThrow();
  });

  it('accepts disallowedTools as an alias and keeps unknown hook fields', () => {
    const hooks = { Stop: [{ hooks: [{ type: 'command', command: 'x', extra: 1 }] }] };
    expect(
      claudeSkillFrontmatterSchema.parse({ disallowedTools: ['Bash'], hooks }) as unknown,
    ).toEqual({
      disallowedTools: ['Bash'],
      hooks,
    });
  });
});

describe('codexSkillFrontmatterSchema', () => {
  it('requires name and description', () => {
    expect(codexSkillFrontmatterSchema.parse({ name: 'a', description: 'b' })).toEqual({
      name: 'a',
      description: 'b',
    });
    expect(() => codexSkillFrontmatterSchema.parse({ name: 'a' })).toThrow();
    expect(() => codexSkillFrontmatterSchema.parse({ description: 'b' })).toThrow();
  });

  it('keeps the agentskills.io fields and drops Claude-only ones', () => {
    expect(
      codexSkillFrontmatterSchema.parse({
        name: 'a',
        description: 'b',
        metadata: { 'short-description': 'Short.' },
        model: 'sonnet',
      }),
    ).toEqual({ name: 'a', description: 'b', metadata: { 'short-description': 'Short.' } });
  });
});

describe('parsing a mapping', () => {
  it('collects keys neither tool reads, and accepts Claude keys for Codex', () => {
    const mapping = { name: 'a', description: 'b', model: 'sonnet', sparkle: true };
    expect(parseClaudeSkillMapping(mapping, 'Body.').unknownKeys).toEqual(['sparkle']);

    const codex = parseCodexSkillMapping(mapping, 'Body.');
    expect(codex.unknownKeys).toEqual(['sparkle']);
    expect(codex.frontmatter).toEqual({ name: 'a', description: 'b' });
    expect(codex.body).toBe('Body.');
  });
});

describe('openaiConfigurationSchema', () => {
  it('accepts the current interface, policy, and dependency fields', () => {
    const configuration = {
      interface: { display_name: 'My Skill', brand_color: '#3B82F6' },
      policy: { allow_implicit_invocation: false, products: ['codex', 'CHATGPT'] },
      dependencies: {
        tools: [
          { type: 'mcp', value: 'docs', command: 'docs-server', oauth: { callbackPort: 8765 } },
        ],
      },
    };
    expect(openaiConfigurationSchema.parse(configuration) as unknown).toEqual(configuration);
    expect(() => openaiConfigurationSchema.parse({ policy: { products: ['slack'] } })).toThrow();
  });
});

describe('claudeSettingsEffortSchema', () => {
  it('accepts exactly what settings.json effortLevel accepts', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh']) {
      expect<string>(claudeSettingsEffortSchema.parse(level)).toBe(level);
    }
    for (const level of ['max', 'ultracode', 8000]) {
      expect(claudeSettingsEffortSchema.safeParse(level).success).toBe(false);
    }
  });
});

describe('isMapping', () => {
  it('accepts plain objects only', () => {
    expect(isMapping({})).toBe(true);
    expect(isMapping([])).toBe(false);
    expect(isMapping(null)).toBe(false);
    expect(isMapping('x')).toBe(false);
  });
});
