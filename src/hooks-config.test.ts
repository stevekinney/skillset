import { describe, expect, it } from 'bun:test';

import {
  checkHooksSource,
  hookEntry,
  hookHandler,
  hookName,
  hookTargets,
  parseHooksSource,
} from './hooks-config.js';

const raw = `hooks:
  PreToolUse:
    - matcher: Bash
      command: ./check.sh
      timeout: 10
      statusMessage: Checking…
      codex:
        timeout: 20
  FileChanged:
    - command: ./watch.sh
      targets: [claude]
      claude:
        async: true
`;

describe('parseHooksSource', () => {
  it('parses and validates', () => {
    const source = parseHooksSource(raw);
    expect(source.hooks['PreToolUse']).toHaveLength(1);
    expect(source.hooks['FileChanged']?.[0]?.targets).toEqual(['claude']);
  });

  it('rejects non-mappings and schema violations', () => {
    expect(() => parseHooksSource('- a\n')).toThrow('YAML mapping');
    expect(() => parseHooksSource('hooks:\n  PreToolUse:\n    - timeout: 5\n')).toThrow();
  });
});

describe('hookTargets and hookName', () => {
  it('defaults to both targets and builds stable names', () => {
    const source = parseHooksSource(raw);
    expect(hookTargets(source.hooks['PreToolUse']![0]!)).toEqual(['claude', 'codex']);
    expect(hookName('PreToolUse', source.hooks['PreToolUse']![0]!, 0)).toBe('PreToolUse/Bash/0');
    expect(hookName('Stop', { type: 'command', command: 'x' }, 2)).toBe('Stop/*/2');
  });
});

describe('hookEntry', () => {
  it('builds the shared entry shape with per-target overrides merged last', () => {
    const definition = parseHooksSource(raw).hooks['PreToolUse']![0]!;

    expect(hookEntry(definition, 'claude')).toEqual({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: './check.sh', timeout: 10, statusMessage: 'Checking…' }],
    });
    expect(hookEntry(definition, 'codex')).toEqual({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: './check.sh', timeout: 20, statusMessage: 'Checking…' }],
    });
  });

  it('omits matcher when absent and applies claude overrides', () => {
    const definition = parseHooksSource(raw).hooks['FileChanged']![0]!;
    expect(hookEntry(definition, 'claude')).toEqual({
      hooks: [{ type: 'command', command: './watch.sh', async: true }],
    });
  });
});

const messages = (input: string): string[] =>
  checkHooksSource(parseHooksSource(input)).map((issue) => `${issue.severity}: ${issue.message}`);

describe('checkHooksSource', () => {
  it('passes a valid source with the codex re-trust warning', () => {
    const report = messages(raw);
    expect(report).toEqual([
      'warning: syncing hooks rewrites Codex hook config — Codex will require re-trusting them via /hooks',
    ]);
  });

  it('errors on unknown events', () => {
    expect(messages('hooks:\n  OnSneeze:\n    - command: x\n')[0]).toContain(
      'unknown hook event `OnSneeze`',
    );
  });

  it('errors on Claude-only events without a targets restriction', () => {
    const report = messages('hooks:\n  FileChanged:\n    - command: x\n');
    expect(report.join('\n')).toContain('`FileChanged` is Claude-only');
  });

  it('accepts the model-switch events for claude', () => {
    expect(
      messages(
        'hooks:\n  PreModelSwitch:\n    - command: x\n      targets: [claude]\n  PostModelSwitch:\n    - command: y\n      targets: [claude]\n',
      ),
    ).toEqual([]);
  });

  it('errors on Codex-only events without a targets restriction', () => {
    const report = messages('hooks:\n  Interrupt:\n    - command: x\n');
    expect(report).toContain(
      'error: hook event `Interrupt` is Codex-only — add `targets: [codex]` to the `x` hook',
    );
    expect(report.join('\n')).not.toContain('Claude-only');
  });

  it('accepts Codex-only events restricted to codex', () => {
    expect(messages('hooks:\n  Interrupt:\n    - command: x\n      targets: [codex]\n')).toEqual([
      'warning: syncing hooks rewrites Codex hook config — Codex will require re-trusting them via /hooks',
    ]);
  });

  it('emits no re-trust warning for claude-only sources', () => {
    expect(messages('hooks:\n  FileChanged:\n    - command: x\n      targets: [claude]\n')).toEqual(
      [],
    );
  });
});

describe('handler types', () => {
  const source = `hooks:
  PreToolUse:
    - type: http
      url: https://example.com/hook
      headers: { Authorization: token }
      allowedEnvVars: [TOKEN]
      targets: [claude]
    - type: mcp_tool
      server: audit
      tool: record
      input: { event: start }
    - type: prompt
      prompt: Is this safe?
      model: haiku
      targets: [claude]
    - type: agent
      prompt: Verify the change
      targets: [claude]
  SessionEnd:
    - type: mcp_tool
      server: audit
      tool: record
      targets: [claude]
`;

  it('defaults a missing type to command and keeps every handler type', () => {
    const parsed = parseHooksSource(source);
    expect(parsed.hooks['PreToolUse']?.map((definition) => definition.type)).toEqual([
      'http',
      'mcp_tool',
      'prompt',
      'agent',
    ]);
    expect(parseHooksSource(raw).hooks['PreToolUse']?.[0]?.type).toBe('command');
    expect(() =>
      parseHooksSource('hooks:\n  Stop:\n    - type: shell\n      command: x\n'),
    ).toThrow();
    expect(() => parseHooksSource('hooks:\n  Stop:\n    - type: http\n')).toThrow();
  });

  it('builds a handler per type with overrides merged last', () => {
    const [http, mcp, prompt, agent] = parseHooksSource(source).hooks['PreToolUse']!;
    expect(hookEntry(http!, 'claude')).toEqual({
      hooks: [
        {
          type: 'http',
          url: 'https://example.com/hook',
          headers: { Authorization: 'token' },
          allowedEnvVars: ['TOKEN'],
        },
      ],
    });
    expect(hookEntry(mcp!, 'codex')).toEqual({
      hooks: [{ type: 'mcp_tool', server: 'audit', tool: 'record', input: { event: 'start' } }],
    });
    expect(hookHandler(prompt!, 'claude')).toEqual({
      type: 'prompt',
      prompt: 'Is this safe?',
      model: 'haiku',
    });
    expect(hookHandler(agent!, 'claude')['prompt']).toBe('Verify the change');
  });

  it('accepts every type on Claude and mcp_tool on Codex', () => {
    expect(messages(source)).toEqual([
      'warning: syncing hooks rewrites Codex hook config — Codex will require re-trusting them via /hooks',
    ]);
  });

  it('errors when Codex is a target of a handler type it cannot run', () => {
    const report = messages(
      'hooks:\n  Stop:\n    - type: prompt\n      prompt: Check\n    - type: agent\n      prompt: Verify\n    - type: http\n      url: https://example.com\n',
    );
    expect(report).toContain(
      'error: handler type `prompt` is skipped by Codex — add `targets: [claude]` to the `Check` hook',
    );
    expect(report).toContain(
      'error: handler type `agent` is skipped by Codex — add `targets: [claude]` to the `Verify` hook',
    );
    expect(report).toContain(
      'error: handler type `http` is not run by Codex — add `targets: [claude]` to the `https://example.com` hook',
    );
  });

  it('errors on a Codex mcp_tool handler for SessionEnd', () => {
    expect(
      messages('hooks:\n  SessionEnd:\n    - type: mcp_tool\n      server: s\n      tool: t\n'),
    ).toContain(
      'error: Codex does not run `mcp_tool` handlers on `SessionEnd` — add `targets: [claude]` to the `s/t` hook',
    );
  });

  it('reports an override that changes the handler type to an unknown one', () => {
    const report = messages(
      'hooks:\n  Stop:\n    - command: x\n      claude:\n        type: mystery\n      codex:\n        type: mystery\n',
    );
    expect(report).toContain(
      'error: handler type `mystery` is not run by Claude — add `targets: [codex]` to the `x` hook',
    );
    expect(report).toContain(
      'error: handler type `mystery` is not run by Codex — add `targets: [claude]` to the `x` hook',
    );
  });

  it('validates each merged handler against its target schema', () => {
    const report = messages(
      'hooks:\n  Stop:\n    - command: x\n      claude:\n        shell: zsh\n      codex:\n        timeout: -1\n        async: maybe\n',
    );
    expect(report.some((line) => line.startsWith('error: hook `x` for Claude: `shell`'))).toBe(
      true,
    );
    expect(report.some((line) => line.startsWith('error: hook `x` for Codex: `async`'))).toBe(true);
  });

  it('warns about fields a target does not read', () => {
    const report = messages(
      'hooks:\n  Stop:\n    - command: x\n      claude:\n        mystery: 1\n        if: Bash(ls)\n      codex:\n        if: Bash(ls)\n        commandWindows: x.cmd\n',
    );
    expect(report).toContain(
      'warning: hook `x` for Claude has unknown field `mystery` — Claude ignores it',
    );
    expect(report).toContain(
      'warning: hook `x` for Codex has unknown field `if` — Codex ignores it',
    );
    expect(report.join('\n')).not.toContain('commandWindows');
    expect(report.join('\n')).not.toContain('field `if` — Claude');
  });
});
