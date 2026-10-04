import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';

import { multiAgentModeSchema, reasoningEffortSchema } from './codex-session-shared.js';

/** The known members of an open enum, with the open `string` member removed. */
type KnownMembers<Value> = Value extends string ? (string extends Value ? never : Value) : never;

describe('open enums', () => {
  it('accept the known values and any other string', () => {
    expect(reasoningEffortSchema.parse('high')).toBe('high');
    expect(reasoningEffortSchema.parse('some-future-level')).toBe('some-future-level');
    expect(reasoningEffortSchema.safeParse(3).success).toBe(false);
    expect(multiAgentModeSchema.parse('proactive')).toBe('proactive');
  });

  it('keep the known values in the inferred type for autocomplete', () => {
    const known: KnownMembers<z.infer<typeof reasoningEffortSchema>> = 'xhigh';
    const mode: KnownMembers<z.infer<typeof multiAgentModeSchema>> = 'explicitRequestOnly';
    expect([known, mode]).toEqual(['xhigh', 'explicitRequestOnly']);
  });
});
