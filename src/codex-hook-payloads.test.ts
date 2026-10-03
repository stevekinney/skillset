import { describe, expect, it } from 'bun:test';

import {
  codexHookEventNames,
  codexHookInputSchemas,
  codexHookOutputSchemas,
  parseCodexHookInput,
  parseCodexHookOutput,
  safeParseCodexHookInput,
  type CodexHookInputFor,
} from './codex-hook-payloads.js';

const base = { session_id: 's', transcript_path: null, cwd: '/w' };
const turn = { ...base, model: 'gpt', turn_id: 't' };
const mode = { permission_mode: 'default' };
const tool = { ...turn, ...mode, tool_name: 'Bash', tool_input: { command: 'ls' } };

const samples: Record<(typeof codexHookEventNames)[number], Record<string, unknown>> = {
  SessionStart: { ...base, model: 'gpt', ...mode, source: 'fork' },
  SessionEnd: { ...base, reason: 'other' },
  SubagentStart: { ...turn, ...mode, agent_id: 'a', agent_type: 'default' },
  UserPromptSubmit: { ...turn, ...mode, prompt: 'hi', agent_id: 'a' },
  PreToolUse: { ...tool, tool_use_id: 'u' },
  PermissionRequest: tool,
  PostToolUse: { ...tool, tool_use_id: 'u', tool_response: 'ok' },
  PreCompact: { ...turn, trigger: 'manual' },
  PostCompact: { ...turn, trigger: 'auto', agent_type: 'x' },
  Stop: { ...turn, ...mode, stop_hook_active: false, last_assistant_message: null },
  SubagentStop: {
    ...turn,
    ...mode,
    agent_id: 'a',
    agent_type: 'x',
    agent_transcript_path: null,
    stop_hook_active: true,
    last_assistant_message: 'done',
  },
  Interrupt: { ...turn, ...mode },
};

describe('Codex hook input schemas', () => {
  it('covers all 12 events', () => {
    expect(codexHookEventNames).toHaveLength(12);
    expect(Object.keys(codexHookInputSchemas).toSorted()).toEqual(
      [...codexHookEventNames].toSorted(),
    );
  });

  for (const name of codexHookEventNames) {
    it(`parses a ${name} payload and keeps fields from a newer version`, () => {
      const parsed = parseCodexHookInput({ ...samples[name], hook_event_name: name, extra: 1 });
      expect(parsed.hook_event_name).toBe(name);
      expect((parsed as Record<string, unknown>)['extra']).toBe(1);
    });

    it(`rejects a ${name} payload without session_id`, () => {
      const { session_id: _omitted, ...rest } = samples[name];
      expect(safeParseCodexHookInput({ ...rest, hook_event_name: name }).success).toBe(false);
    });
  }

  it('requires a null or string transcript_path key', () => {
    const { transcript_path: _omitted, ...rest } = samples['Stop'];
    expect(safeParseCodexHookInput({ ...rest, hook_event_name: 'Stop' }).success).toBe(false);
    expect(
      safeParseCodexHookInput({
        ...samples['Stop'],
        transcript_path: '/t',
        hook_event_name: 'Stop',
      }).success,
    ).toBe(true);
  });

  it('narrows by event name and throws on an unknown event', () => {
    const parsed = parseCodexHookInput({
      ...samples['SessionStart'],
      hook_event_name: 'SessionStart',
    });
    if (parsed.hook_event_name === 'SessionStart') {
      const typed: CodexHookInputFor<'SessionStart'> = parsed;
      expect(typed.source).toBe('fork');
    }
    expect(() => parseCodexHookInput({ ...base, hook_event_name: 'Nope' })).toThrow();
  });
});

describe('Codex hook output schemas', () => {
  it('has a schema for every event', () => {
    expect(Object.keys(codexHookOutputSchemas).toSorted()).toEqual(
      [...codexHookEventNames].toSorted(),
    );
  });

  const universal = { continue: false, stopReason: 's', suppressOutput: false, systemMessage: 'm' };
  const accepted: [(typeof codexHookEventNames)[number], Record<string, unknown>][] = [
    [
      'SessionStart',
      {
        ...universal,
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'c' },
      },
    ],
    ['SubagentStart', { hookSpecificOutput: { hookEventName: 'SubagentStart' } }],
    [
      'UserPromptSubmit',
      {
        decision: 'block',
        reason: 'r',
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'c' },
      },
    ],
    ['PreToolUse', { decision: 'block', reason: 'r' }],
    ['PreToolUse', { continue: true, suppressOutput: false, systemMessage: 'm' }],
    [
      'PreToolUse',
      {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'r',
          updatedInput: {},
          additionalContext: 'c',
        },
      },
    ],
    [
      'PermissionRequest',
      {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: 'no', interrupt: false },
        },
      },
    ],
    ['PermissionRequest', { hookSpecificOutput: { hookEventName: 'PermissionRequest' } }],
    [
      'PostToolUse',
      {
        decision: 'block',
        reason: 'r',
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'c' },
      },
    ],
    ['PreCompact', universal],
    ['PostCompact', {}],
    ['Stop', { ...universal, decision: 'block', reason: 'again' }],
    ['SubagentStop', { decision: 'block', reason: 'again' }],
    ['Interrupt', { systemMessage: 'x' }],
  ];

  for (const [name, output] of accepted) {
    it(`accepts a ${name} output ${JSON.stringify(output).slice(0, 40)}`, () => {
      expect(parseCodexHookOutput(name, output)).toEqual(output);
    });
  }

  const rejected: [(typeof codexHookEventNames)[number], Record<string, unknown>][] = [
    ['SessionStart', { surprise: true }],
    ['UserPromptSubmit', { decision: 'approve' }],
    ['PreToolUse', { hookSpecificOutput: { hookEventName: 'PreToolUse', surprise: 1 } }],
    ['PermissionRequest', { decision: 'block' }],
    ['PostToolUse', { decision: 'approve' }],
    ['Stop', { hookSpecificOutput: { hookEventName: 'Stop' } }],
    ['PreCompact', { decision: 'block' }],
    ['Interrupt', { continue: false }],
    // Universal values that make Codex fail a tool-event hook run.
    ['PreToolUse', { suppressOutput: true }],
    ['PermissionRequest', { continue: false }],
    ['PostToolUse', { stopReason: 'halt' }],
  ];

  for (const [name, output] of rejected) {
    it(`rejects a ${name} output ${JSON.stringify(output).slice(0, 40)}`, () => {
      expect(() => parseCodexHookOutput(name, output)).toThrow();
    });
  }

  it('returns the output type of the event it parsed', () => {
    const stop = parseCodexHookOutput('Stop', { decision: 'block', reason: 'again' });
    const decision: 'block' | undefined = stop.decision;
    expect(decision).toBe('block');
  });

  it('accepts anything for SessionEnd because Codex never parses its stdout', () => {
    expect(parseCodexHookOutput('SessionEnd', 'free text')).toBe('free text');
  });
});
