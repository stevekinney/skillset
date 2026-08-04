import { describe, expect, it } from 'bun:test';

import { claudeAgentFrontmatter, impliedSandboxMode, parseAgentFile } from './agent-frontmatter.js';

const full = `---
name: reviewer
description: Reviews diffs.
tools: Read, Grep, Bash
disallowedTools: Write
model: haiku
permissionMode: plan
maxTurns: 10
skills: [code-style]
mcpServers: [codex]
hooks:
  PreToolUse: []
memory: user
background: true
effort: low
isolation: worktree
color: cyan
initialPrompt: Review the diff.
codex:
  model: gpt-5.6-luna
  model_reasoning_effort: low
  sandbox_mode: read-only
  nickname_candidates: [rev]
---

You review diffs.
`;

describe('parseAgentFile', () => {
  it('parses the full union frontmatter and body', () => {
    const parsed = parseAgentFile(full);
    expect(parsed.frontmatter.name).toBe('reviewer');
    expect(parsed.frontmatter.color).toBe('cyan');
    expect(parsed.frontmatter.codex?.model).toBe('gpt-5.6-luna');
    expect(parsed.unknownKeys).toEqual([]);
    expect(parsed.body).toBe('\nYou review diffs.\n');
  });

  it('collects unknown keys', () => {
    const parsed = parseAgentFile('---\nname: a\ndescription: b\nmystery: 1\n---\nbody');
    expect(parsed.unknownKeys).toEqual(['mystery']);
  });

  it('rejects invalid enums', () => {
    expect(() =>
      parseAgentFile('---\nname: a\ndescription: b\npermissionMode: sudo\n---\nbody'),
    ).toThrow();
    expect(() =>
      parseAgentFile('---\nname: a\ndescription: b\ncodex:\n  sandbox_mode: yolo\n---\nbody'),
    ).toThrow();
  });
});

describe('claudeAgentFrontmatter', () => {
  it('keeps Claude fields and drops the codex block', () => {
    const fields = claudeAgentFrontmatter(parseAgentFile(full).frontmatter);
    expect(fields['permissionMode']).toBe('plan');
    expect(fields['initialPrompt']).toBe('Review the diff.');
    expect(fields['codex']).toBeUndefined();
  });
});

describe('impliedSandboxMode', () => {
  it('maps plan to read-only and acceptEdits to workspace-write', () => {
    expect(impliedSandboxMode('plan')).toBe('read-only');
    expect(impliedSandboxMode('acceptEdits')).toBe('workspace-write');
  });

  it('returns undefined for unmappable modes', () => {
    expect(impliedSandboxMode('bypassPermissions')).toBeUndefined();
    expect(impliedSandboxMode(undefined)).toBeUndefined();
  });
});
