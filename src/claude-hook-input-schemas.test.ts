import { describe, expect, it } from 'bun:test';

import {
  claudeHookInputSchemas,
  parseClaudeHookInput,
  safeParseClaudeHookInput,
  type ClaudeHookInput,
  type ClaudeHookInputFor,
} from './claude-hook-input-schemas.js';
import { claudeHookEventNames } from './claude-hook-shared.js';

const common = { session_id: 's1', transcript_path: '/t.jsonl', cwd: '/work' };
const model = {
  from_model: 'a',
  to_model: 'b',
  requested_model: null,
  context_tokens: 0,
  prompt_cache_warm: false,
  cache_ttl: '5m',
  estimated_cache_write_usd: 0.1,
  pricing: 'default',
};
const task = { task_id: 't', task_subject: 'subject' };

const samples: Record<(typeof claudeHookEventNames)[number], Record<string, unknown>> = {
  PreToolUse: { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'u' },
  PostToolUse: {
    tool_name: 'Bash',
    tool_input: {},
    tool_use_id: 'u',
    tool_response: 'ok',
    duration_ms: 5,
  },
  PostToolUseFailure: {
    tool_name: 'Bash',
    tool_input: {},
    tool_use_id: 'u',
    error: 'boom',
    is_interrupt: true,
  },
  PostToolBatch: { tool_calls: [{ tool_name: 'Bash', tool_input: {}, tool_use_id: 'u' }] },
  Notification: { message: 'm', notification_type: 'idle_prompt' },
  UserPromptSubmit: { prompt: 'hi', source: 'user' },
  UserPromptExpansion: {
    expansion_type: 'slash_command',
    command_name: 'x',
    command_args: '',
    prompt: 'p',
  },
  SessionStart: { source: 'fork', model: 'm', context_tokens: 3 },
  SessionEnd: { reason: 'other' },
  Stop: {
    stop_hook_active: false,
    background_tasks: [{ id: '1', type: 'shell', status: 'running', description: 'd' }],
    session_crons: [{ id: '1', schedule: '* * * * *', recurring: true, prompt: 'p' }],
  },
  StopFailure: { error: 'verification_required' },
  SubagentStart: { agent_id: 'a', agent_type: 'Explore' },
  SubagentStop: {
    stop_hook_active: true,
    agent_id: 'a',
    agent_transcript_path: '/a.jsonl',
    agent_type: 'Explore',
  },
  PreCompact: { trigger: 'auto', custom_instructions: null },
  PostCompact: { trigger: 'manual', compact_summary: 's' },
  PreModelSwitch: { ...model, source: 'picker' },
  PostModelSwitch: { ...model, source: 'resume' },
  PermissionRequest: {
    tool_name: 'Bash',
    tool_input: {},
    permission_suggestions: [
      { type: 'addDirectories', directories: ['/x'], destination: 'session' },
    ],
  },
  PermissionDenied: { tool_name: 'Bash', tool_input: {}, tool_use_id: 'u', reason: 'r' },
  Setup: { trigger: 'init' },
  TeammateIdle: { teammate_name: 'n', team_name: 't' },
  TaskCreated: task,
  TaskCompleted: { ...task, teammate_name: 'n' },
  Elicitation: { mcp_server_name: 's', message: 'm', mode: 'form', requested_schema: {} },
  ElicitationResult: { mcp_server_name: 's', action: 'accept', content: { a: 1 } },
  ConfigChange: { source: 'skills' },
  WorktreeCreate: { name: 'bold-oak-a3f2' },
  WorktreeRemove: { worktree_path: '/w' },
  InstructionsLoaded: { file_path: '/f', memory_type: 'Project', load_reason: 'include' },
  CwdChanged: { old_cwd: '/a', new_cwd: '/b' },
  FileChanged: { file_path: '/f', event: 'unlink' },
  DirectoryAdded: { directory: '/d', source: 'slash_command' },
  MessageDisplay: { turn_id: 't', message_id: 'm', index: 0, final: true, delta: 'x' },
};

describe('Claude hook input schemas', () => {
  it('covers all 33 events', () => {
    expect(claudeHookEventNames).toHaveLength(33);
    expect(Object.keys(claudeHookInputSchemas).toSorted()).toEqual(
      [...claudeHookEventNames].toSorted(),
    );
  });

  for (const name of claudeHookEventNames) {
    it(`parses a ${name} payload and keeps fields from a newer version`, () => {
      const payload = { ...common, hook_event_name: name, ...samples[name], future_field: 1 };
      const parsed = parseClaudeHookInput(payload);
      expect(parsed.hook_event_name).toBe(name);
      expect((parsed as Record<string, unknown>)['future_field']).toBe(1);
    });

    it(`rejects a ${name} payload without session_id`, () => {
      const { session_id: _omitted, ...withoutSession } = common;
      expect(
        safeParseClaudeHookInput({ ...withoutSession, hook_event_name: name, ...samples[name] })
          .success,
      ).toBe(false);
    });
  }

  it('accepts every common optional field', () => {
    const parsed = parseClaudeHookInput({
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      scratchpad_dir: '/s',
      prompt_id: 'p',
      permission_mode: 'plan',
      agent_id: 'a',
      agent_type: 'x',
      effort: { level: 'xhigh' },
    });
    expect(parsed.effort?.level).toBe('xhigh');
  });

  it('narrows by event name', () => {
    const parsed: ClaudeHookInput = parseClaudeHookInput({
      ...common,
      hook_event_name: 'PreToolUse',
      ...samples['PreToolUse'],
    });
    if (parsed.hook_event_name === 'PreToolUse') {
      const typed: ClaudeHookInputFor<'PreToolUse'> = parsed;
      expect(typed.tool_use_id).toBe('u');
    }
  });

  it('throws for an unknown event and returns a failure from the safe variant', () => {
    const payload = { ...common, hook_event_name: 'Nope' };
    expect(() => parseClaudeHookInput(payload)).toThrow();
    expect(safeParseClaudeHookInput(payload).success).toBe(false);
  });
});
