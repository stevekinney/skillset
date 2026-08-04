import { describe, expect, it } from 'bun:test';
import { parse as parseToml } from 'smol-toml';

import { emitClaudeAgent, emitCodexAgent, GENERATED_MARKER_TOML } from './agent-emit.js';
import { parseAgentFile } from './agent-frontmatter.js';
import { GENERATED_MARKER } from './emit.js';

const source = `---
name: reviewer
description: Reviews diffs.
tools: Read, Grep
disallowedTools: Write
model: haiku
permissionMode: plan
codex:
  model: gpt-5.6-luna
  model_reasoning_effort: low
---

<!-- #if claude -->
Repo: !\`git rev-parse HEAD\`
<!-- #else -->
Run \`git rev-parse HEAD\` yourself.
<!-- #endif -->

Review the diff in \${CLAUDE_PROJECT_DIR}.
`;

describe('emitClaudeAgent', () => {
  it('keeps Claude fields, the marker, and the raw dynamic body', () => {
    const output = emitClaudeAgent(parseAgentFile(source));
    expect(output).toContain('model: haiku');
    expect(output).toContain('permissionMode: plan');
    expect(output).not.toContain('codex:');
    expect(output).toContain(GENERATED_MARKER);
    expect(output).toContain('Repo: !`git rev-parse HEAD`');
    expect(output).toContain('${CLAUDE_PROJECT_DIR}');
    expect(output).not.toContain('yourself');
  });

  it('throws on structural template errors', () => {
    const broken = parseAgentFile('---\nname: a\ndescription: b\n---\n<!-- #if claude -->\nx');
    expect(() => emitClaudeAgent(broken)).toThrow('template errors');
  });
});

describe('emitCodexAgent', () => {
  it('emits valid TOML with fallbacks, tool guidance, and the marker comment', () => {
    const output = emitCodexAgent(parseAgentFile(source));
    expect(output.startsWith(GENERATED_MARKER_TOML)).toBe(true);

    const parsed = parseToml(output) as Record<string, unknown>;
    expect(parsed['name']).toBe('reviewer');
    expect(parsed['model']).toBe('gpt-5.6-luna');
    expect(parsed['model_reasoning_effort']).toBe('low');
    expect(parsed['sandbox_mode']).toBe('read-only');

    const instructions = parsed['developer_instructions'];
    expect(instructions).toContain('Run `git rev-parse HEAD` yourself.');
    expect(instructions).toContain('the project root');
    expect(instructions).toContain('Only use these tools: Read, Grep.');
    expect(instructions).toContain('Never use these tools: Write.');
    expect(instructions).not.toContain('!`');
  });

  it('lets an explicit codex.sandbox_mode win over permissionMode', () => {
    const raw = source.replace('model_reasoning_effort: low', 'sandbox_mode: workspace-write');
    const parsed = parseToml(emitCodexAgent(parseAgentFile(raw))) as Record<string, unknown>;
    expect(parsed['sandbox_mode']).toBe('workspace-write');
  });

  it('emits nickname_candidates and falls back to escaped strings for bodies with triple quotes', () => {
    const raw = `---
name: quoter
description: Quotes.
codex:
  nickname_candidates: [q]
---

Contains ''' inside.
`;
    const output = emitCodexAgent(parseAgentFile(raw));
    const parsed = parseToml(output) as Record<string, unknown>;
    expect(parsed['nickname_candidates']).toEqual(['q']);
    expect(parsed['developer_instructions']).toContain("Contains ''' inside.");
  });

  it('omits sandbox_mode when nothing maps', () => {
    const raw = '---\nname: a\ndescription: b\n---\nBody.';
    const parsed = parseToml(emitCodexAgent(parseAgentFile(raw))) as Record<string, unknown>;
    expect(parsed['sandbox_mode']).toBeUndefined();
    expect(parsed['developer_instructions']).toBe('Body.\n');
  });

  it('emits codex passthrough tables after developer_instructions', () => {
    const raw = `---
name: hooked
description: Has hooks.
codex:
  model_verbosity: low
  hooks:
    hooks:
      PreToolUse:
        - matcher: '.*'
          hooks:
            - type: command
              command: echo hi
  mcp_servers:
    codex:
      command: codex
      args: [mcp-server]
  tools:
    web_search: true
---

Body.
`;
    const output = emitCodexAgent(parseAgentFile(raw));
    const parsed = parseToml(output) as Record<string, unknown>;

    expect(parsed['model_verbosity']).toBe('low');
    expect(parsed['developer_instructions']).toBe('Body.\n');
    expect(parsed['hooks']).toMatchObject({ hooks: { PreToolUse: [{ matcher: '.*' }] } });
    expect(parsed['mcp_servers']).toMatchObject({ codex: { command: 'codex' } });
    expect(parsed['tools']).toEqual({ web_search: true });

    // Tables must come after the developer_instructions scalar, or TOML
    // would swallow it into the preceding table.
    expect(output.indexOf('developer_instructions')).toBeLessThan(output.indexOf('[hooks'));
  });
});
