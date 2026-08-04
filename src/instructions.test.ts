import { describe, expect, it } from 'bun:test';

import { GENERATED_MARKER } from './emit.js';
import { checkInstructions, emitInstructions } from './instructions.js';

const source = `# Rules

<!-- #if claude -->

@~/.claude/extra-rules.md

<!-- #else -->

Follow the extra rules in your instructions.

<!-- #endif -->

Shared guidance.
`;

describe('emitInstructions', () => {
  it('renders per-target with the marker and no fallback rewriting', () => {
    const claude = emitInstructions(source, 'claude');
    expect(claude.startsWith(GENERATED_MARKER)).toBe(true);
    expect(claude).toContain('@~/.claude/extra-rules.md');
    expect(claude).not.toContain('Follow the extra rules');

    const codex = emitInstructions(source, 'codex');
    expect(codex).toContain('Follow the extra rules');
    expect(codex).not.toContain('@~/.claude');
    expect(codex).not.toContain('#if');
  });

  it('throws on structural template errors', () => {
    expect(() => emitInstructions('<!-- #if claude -->\nx', 'claude')).toThrow('template errors');
  });
});

describe('checkInstructions', () => {
  it('passes guarded imports and reports unguarded ones', () => {
    expect(checkInstructions(source)).toEqual([]);

    const unguarded = checkInstructions('Read @AGENTS.md for details.\n\n@./rules.md\n');
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0]?.message).toContain('`@./rules.md` looks like a Claude memory import');
  });

  it('reports template errors with line numbers', () => {
    const issues = checkInstructions('text\n<!-- #endif -->\n');
    expect(issues[0]?.severity).toBe('error');
    expect(issues[0]?.message).toContain('line 2');
  });
});
