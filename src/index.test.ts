import { describe, expect, it } from 'bun:test';

import { claudeSkillFrontmatterSchema, validateSkillMetadata } from './index.js';

it('loads the test preload', () => {
  expect((globalThis as Record<string, unknown>)['__BUN_TEST_SETUP_LOADED__']).toBe(true);
});

describe('public surface', () => {
  it('exports the schemas and validators', () => {
    expect(claudeSkillFrontmatterSchema.parse({})).toEqual({});
    expect(typeof validateSkillMetadata).toBe('function');
  });
});
