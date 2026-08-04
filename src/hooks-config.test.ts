import { describe, expect, it } from 'bun:test';

import {
  checkHooksSource,
  hookEntry,
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
    expect(hookName('Stop', { command: 'x' }, 2)).toBe('Stop/*/2');
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

  it('emits no re-trust warning for claude-only sources', () => {
    expect(messages('hooks:\n  FileChanged:\n    - command: x\n      targets: [claude]\n')).toEqual(
      [],
    );
  });
});
