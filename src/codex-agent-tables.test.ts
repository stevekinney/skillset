import { describe, expect, it } from 'bun:test';

import {
  ambiguousCodexSkillRules,
  codexSkillsSchema,
  codexToolsSchema,
  hasEffectiveCodexSkillSettings,
  unknownCodexSkillFields,
  unknownCodexToolFields,
} from './codex-agent-tables.js';

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

  it('finds unknown fields at every level', () => {
    const skills = codexSkillsSchema.parse({
      extra: 1,
      bundled: { enabled: true, extra: 1 },
      config: [{ name: 'a', enabled: true, extra: 1 }],
    });
    expect(unknownCodexSkillFields(skills)).toEqual([
      'skills.extra',
      'skills.bundled.extra',
      'skills.config[0].extra',
    ]);
    expect(unknownCodexSkillFields({})).toEqual([]);
  });

  it('finds rules without exactly one selector', () => {
    const skills = codexSkillsSchema.parse({
      config: [
        { path: 'a', enabled: false },
        { path: 'a', name: 'a', enabled: false },
        { enabled: false },
      ],
    });
    expect(ambiguousCodexSkillRules(skills)).toEqual([1, 2]);
    expect(ambiguousCodexSkillRules({})).toEqual([]);
  });

  it('recognises which settings a role file applies', () => {
    expect(hasEffectiveCodexSkillSettings({})).toBe(false);
    expect(hasEffectiveCodexSkillSettings({ config: [{ name: 'a', enabled: true }] })).toBe(false);
    expect(
      hasEffectiveCodexSkillSettings({ bundled: { enabled: true }, include_instructions: true }),
    ).toBe(false);
    expect(hasEffectiveCodexSkillSettings({ config: [{ name: 'a', enabled: false }] })).toBe(true);
    expect(hasEffectiveCodexSkillSettings({ bundled: { enabled: false } })).toBe(true);
    expect(hasEffectiveCodexSkillSettings({ include_instructions: false })).toBe(true);
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

  it('finds unknown fields at every level', () => {
    const tools = codexToolsSchema.parse({
      extra: 1,
      update_plan: { extra: 1 },
      experimental_request_user_input: { enabled: true },
      web_search: { extra: 1, location: { extra: 1 } },
    });
    expect(unknownCodexToolFields(tools)).toEqual([
      'tools.extra',
      'tools.update_plan.extra',
      'tools.web_search.extra',
      'tools.web_search.location.extra',
    ]);
    expect(unknownCodexToolFields({})).toEqual([]);
    expect(unknownCodexToolFields({ web_search: {} })).toEqual([]);
  });
});
