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

const agent = (fields: string): string => `---\nname: a\ndescription: b\n${fields}\n---\nbody\n`;

describe('current Claude Code and Codex agent fields', () => {
  it('accepts the fields added since Claude Code 2.1.221', () => {
    const parsed = parseAgentFile(
      agent('omitClaudeMd: true\nexperimental:\n  cacheTtl: 1h\nisolation: remote\neffort: 4000'),
    ).frontmatter;
    expect(claudeAgentFrontmatter(parsed)).toEqual({
      name: 'a',
      description: 'b',
      omitClaudeMd: true,
      experimental: { cacheTtl: '1h' },
      isolation: 'remote',
      effort: 4000,
    });
    expect(() => parseAgentFile(agent('experimental:\n  cacheTtl: 2h'))).toThrow();
    expect(() => parseAgentFile(agent('isolation: container'))).toThrow();
  });

  it('accepts only true/false spellings for background', () => {
    expect(parseAgentFile(agent('background: "false"')).frontmatter.background).toBe(false);
    expect(parseAgentFile(agent('background: "true"')).frontmatter.background).toBe(true);
    expect(() => parseAgentFile(agent('background: "yes"'))).toThrow();
  });

  it('validates the Codex verbosity and nickname fields like Codex does', () => {
    expect(parseAgentFile(agent('codex:\n  model_verbosity: low')).frontmatter.codex).toEqual({
      model_verbosity: 'low',
    });
    expect(() => parseAgentFile(agent('codex:\n  model_verbosity: loud'))).toThrow();
    expect(() => parseAgentFile(agent('codex:\n  model_reasoning_effort: ""'))).toThrow();

    expect(
      parseAgentFile(agent('codex:\n  nickname_candidates: [Scout, Field_Agent-2]')).frontmatter
        .codex?.nickname_candidates,
    ).toEqual(['Scout', 'Field_Agent-2']);
    for (const invalid of ['[]', '["  "]', '[Scout, " Scout "]', '[Scout!]']) {
      expect(() => parseAgentFile(agent(`codex:\n  nickname_candidates: ${invalid}`))).toThrow();
    }
  });
});
