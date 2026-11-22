import { describe, expect, it } from 'bun:test';

import { isCodexPostModelRequestMcpStructuredContent } from './type-guards.js';

import {
  codexHookEventNames,
  codexHookInputSchemas,
  codexHookOutputSchemas,
  codexPostModelRequestMcpStructuredContentSchema,
  parseCodexHookInput,
  parseCodexHookOutput,
  safeParseCodexHookInput,
  type CodexHookInputFor,
  safeParseCodexHookOutput,
} from './codex-hook-payloads.js';

const base = { session_id: 's', transcript_path: null, cwd: '/w' };
const turn = { ...base, model: 'gpt', turn_id: 't' };
const modelRequest = {
  ...turn,
  kind: 'sampling' as const,
  request_id: 'request',
  attempt_number: 1,
  thread_id: 'thread',
};
const tokenUsage = {
  input_tokens: 12,
  cached_input_tokens: 2,
  output_tokens: 4,
  reasoning_output_tokens: 1,
  total_tokens: 16,
};
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
  PreModelRequest: modelRequest,
  PostModelRequest: {
    ...modelRequest,
    status: 'completed',
    error: null,
    response_id: 'response',
    token_usage: tokenUsage,
  },
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
  it('covers all 14 events', () => {
    expect(codexHookEventNames).toHaveLength(14);
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

  it('parses a failed compaction attempt with nullable outcome fields and a subagent', () => {
    const input = {
      ...modelRequest,
      kind: 'background_compaction',
      attempt_number: 2,
      agent_id: 'subagent',
      agent_type: 'reviewer',
      hook_event_name: 'PostModelRequest',
      status: 'failed',
      error: 'provider error',
      response_id: null,
      token_usage: null,
    } satisfies CodexHookInputFor<'PostModelRequest'>;
    const parsed = parseCodexHookInput(input);
    expect(parsed.hook_event_name).toBe('PostModelRequest');
    if (parsed.hook_event_name !== 'PostModelRequest') throw new Error('Expected post request');
    const payload: CodexHookInputFor<'PostModelRequest'> = parsed;
    expect(payload).toEqual(input);
    expect(payload.status).toBe('failed');
  });

  it('enforces request fields, outcome fields, and integer token counts', () => {
    const pre = { ...modelRequest, hook_event_name: 'PreModelRequest' };
    const post = {
      ...modelRequest,
      hook_event_name: 'PostModelRequest',
      status: 'completed',
      error: null,
      response_id: 'response',
      token_usage: tokenUsage,
    } satisfies CodexHookInputFor<'PostModelRequest'>;
    for (const invalid of [
      { ...pre, request_id: undefined },
      { ...pre, attempt_number: -1 },
      { ...pre, attempt_number: 1.5 },
      { ...pre, kind: 'other' },
      { ...post, status: 'pending' },
      { ...post, error: undefined },
      { ...post, response_id: undefined },
      { ...post, token_usage: undefined },
      { ...post, token_usage: { ...tokenUsage, total_tokens: 1.5 } },
    ]) {
      expect(safeParseCodexHookInput(invalid).success).toBe(false);
    }
    const usage = { ...tokenUsage, cache_write_input_tokens: 3, future: 1 };
    expect(parseCodexHookInput({ ...post, token_usage: usage })).toEqual({
      ...post,
      token_usage: usage,
    });
  });

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

  it('preserves diagnostic model-request stdout without treating it as a directive', () => {
    expect(parseCodexHookOutput('PreModelRequest', 'observed')).toBe('observed');
    expect(parseCodexHookOutput('PostModelRequest', { continue: false })).toEqual({
      continue: false,
    });
  });

  it('returns the output type of the event it parsed', () => {
    const stop = parseCodexHookOutput('Stop', { decision: 'block', reason: 'again' });
    const decision: 'block' | undefined = stop.decision;
    expect(decision).toBe('block');
  });

  it('accepts anything for SessionEnd because Codex never parses its stdout', () => {
    expect(parseCodexHookOutput('SessionEnd', 'free text')).toBe('free text');
  });
});

describe('safeParseCodexHookOutput', () => {
  it('returns a result for the event instead of throwing', () => {
    const result = safeParseCodexHookOutput('Stop', { decision: 'block', reason: 'again' });
    expect(result.success && result.data.decision).toBe('block');
    expect(safeParseCodexHookOutput('PreToolUse', { suppressOutput: true }).success).toBe(false);
  });
});

describe('Codex post-model-request MCP structured content', () => {
  it('accepts null, omitted pricing, or a finite nonnegative charge', () => {
    const schema = codexPostModelRequestMcpStructuredContentSchema;
    for (const output of [null, {}, { extra_codex_rollout_budget_units: 0 }]) {
      expect(schema.parse(output)).toEqual(output);
    }
    const priced = { extra_codex_rollout_budget_units: 0.25, source: 'usage' };
    expect(schema.parse(priced)).toEqual(priced);
    expect(isCodexPostModelRequestMcpStructuredContent(priced)).toBe(true);
    expect(
      isCodexPostModelRequestMcpStructuredContent({ extra_codex_rollout_budget_units: -1 }),
    ).toBe(false);
  });

  it('rejects nonobjects and invalid prices', () => {
    const schema = codexPostModelRequestMcpStructuredContentSchema;
    for (const output of [
      [],
      'text',
      { extra_codex_rollout_budget_units: '1' },
      { extra_codex_rollout_budget_units: -1 },
      { extra_codex_rollout_budget_units: Infinity },
      { extra_codex_rollout_budget_units: null },
    ]) {
      expect(schema.safeParse(output).success).toBe(false);
    }
  });
});
