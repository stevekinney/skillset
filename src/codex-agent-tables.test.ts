import { describe, expect, it } from 'bun:test';

import { codexSkillsSchema, codexToolsSchema } from './codex-agent-tables.js';

const invalidSkills = (value: unknown): boolean => !codexSkillsSchema.safeParse(value).success;
const invalidTools = (value: unknown): boolean => !codexToolsSchema.safeParse(value).success;

describe('codexSkillsSchema', () => {
  it('parses rules and bundled settings', () => {
    const skills = {
      bundled: { enabled: false },
      include_instructions: false,
      max_context_tokens: 4000,
      config: [
        { path: './skills/a/SKILL.md', enabled: false },
        { name: 'b', enabled: true },
      ],
    };
    expect(codexSkillsSchema.parse(skills)).toEqual(skills);
  });

  it('rejects invalid shapes', () => {
    expect(invalidSkills({ config: [{ path: 'a' }] })).toBe(true);
    expect(invalidSkills({ max_context_tokens: 0 })).toBe(true);
    expect(invalidSkills({ config: { path: 'a', enabled: true } })).toBe(true);
    expect(invalidSkills({ include_instructions: 'no' })).toBe(true);
  });
});

describe('codexToolsSchema', () => {
  it('parses the three documented tool tables', () => {
    const tools = {
      experimental_request_user_input: { enabled: false },
      update_plan: { enabled: true },
      web_search: {
        allowed_domains: ['example.com'],
        context_size: 'high' as const,
        location: { city: 'Denver', country: 'US', region: 'CO', timezone: 'America/Denver' },
      },
    };
    expect(codexToolsSchema.parse(tools)).toEqual(tools);
  });

  it('rejects an allowlist array and bad values', () => {
    expect(invalidTools(['read', 'grep'])).toBe(true);
    expect(invalidTools({ web_search: { context_size: 'huge' } })).toBe(true);
    expect(invalidTools({ update_plan: { enabled: 'yes' } })).toBe(true);
  });
});
