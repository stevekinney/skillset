import { describe, expect, it } from 'bun:test';

import { turnItemSchema } from './codex-session-turn-items.js';

const duration = { secs: 1, nanos: 2 };
const searchResult = { type: 'text_result', ref_id: 'r1', title: 't', url: 'https://example.com' };

const items: Record<string, Record<string, unknown>[]> = {
  UserMessage: [
    {
      type: 'UserMessage',
      id: 'i',
      client_id: 'c',
      content: [
        {
          type: 'text',
          text: 'hi',
          text_elements: [{ byte_range: { start: 0, end: 2 }, placeholder: null }],
        },
        { type: 'image', image_url: 'data:x', detail: 'low' },
        { type: 'local_image', path: '/a.png' },
        { type: 'audio', audio_url: 'https://example.com/a.wav' },
        { type: 'local_audio', path: '/a.wav' },
        { type: 'skill', name: 's', path: '/s' },
        { type: 'mention', name: 'm', path: 'app://m' },
      ],
    },
  ],
  FunctionCallOutput: [{ type: 'FunctionCallOutput', id: 'i', name: 'n', output: 'text' }],
  HookPrompt: [{ type: 'HookPrompt', id: 'i', fragments: [{ text: 't', hookRunId: 'run' }] }],
  AgentMessage: [
    {
      type: 'AgentMessage',
      id: 'i',
      content: [{ type: 'Text', text: 't' }],
      phase: 'commentary',
      delivery: 'async',
      memory_citation: {
        entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'n' }],
        rolloutIds: ['r'],
      },
      questions: [{ title: 'q', options: null }],
    },
  ],
  Plan: [{ type: 'Plan', id: 'i', text: 't' }],
  Reasoning: [{ type: 'Reasoning', id: 'i', summary_text: ['s'], raw_content: [] }],
  CommandExecution: [
    {
      type: 'CommandExecution',
      id: 'i',
      command: ['ls'],
      cwd: '/w',
      parsed_cmd: [
        { type: 'read', cmd: 'cat a', name: 'a', path: '/a' },
        { type: 'list_files', cmd: 'ls', path: null },
        { type: 'search', cmd: 'rg x', query: 'x', path: null },
        { type: 'unknown', cmd: 'make' },
      ],
      source: 'user_shell',
      status: 'declined',
      exit_code: 0,
      duration,
    },
  ],
  DynamicToolCall: [
    {
      type: 'DynamicToolCall',
      id: 'i',
      tool: 't',
      arguments: { a: 1 },
      status: 'failed',
      content_items: [
        { type: 'inputText', text: 't' },
        { type: 'inputImage', imageUrl: 'data:x' },
        { type: 'inputAudio', audioUrl: 'https://example.com/a.wav' },
      ],
      success: false,
      error: 'e',
      duration,
    },
  ],
  CollabAgentToolCall: [
    {
      type: 'CollabAgentToolCall',
      id: 'i',
      tool: 'spawn_agent',
      status: 'interrupted',
      sender_thread_id: 's',
      receiver_thread_ids: ['r'],
      receiver_agents: [{ thread_id: 'r', agent_nickname: 'n', agent_role: 'worker' }],
      reasoning_effort: 'low',
      agents_states: {
        a: 'running',
        b: { completed: null },
        c: { errored: 'boom' },
      },
    },
  ],
  SubAgentActivity: [
    {
      type: 'SubAgentActivity',
      id: 'i',
      kind: 'started',
      agent_thread_id: 't',
      agent_path: '/root/a',
    },
  ],
  WebSearch: [
    {
      type: 'WebSearch',
      id: 'i',
      query: 'q',
      action: { type: 'find_in_page', url: 'https://example.com', pattern: 'p' },
      results: [searchResult],
    },
    { type: 'WebSearch', id: 'i', query: 'q', action: { type: 'search', queries: ['q'] } },
    { type: 'WebSearch', id: 'i', query: 'q', action: { type: 'open_page', url: 'https://e.com' } },
    { type: 'WebSearch', id: 'i', query: 'q', action: { type: 'other' } },
  ],
  ImageView: [{ type: 'ImageView', id: 'i', path: 'file:///a.png' }],
  Extension: [
    {
      type: 'Extension',
      kind: 'web.search',
      id: 'i',
      query: 'q',
      action: { type: 'openPage', url: null },
      results: [searchResult],
    },
    {
      type: 'Extension',
      kind: 'web.search',
      id: 'i',
      query: 'q',
      action: { type: 'search', query: 'q' },
    },
    { type: 'Extension', kind: 'web.search', id: 'i', query: 'q', action: { type: 'findInPage' } },
    { type: 'Extension', kind: 'web.search', id: 'i', query: 'q', action: { type: 'other' } },
    { type: 'Extension', kind: 'clock.sleep', id: 'i', durationMs: 30000 },
    {
      type: 'Extension',
      kind: 'image_gen.generation',
      id: 'i',
      status: 'completed',
      revisedPrompt: null,
      result: 'base64',
      failure: { type: 'usageLimitExceeded', limitId: 'l', resetsAt: null },
    },
  ],
  ImageGeneration: [{ type: 'ImageGeneration', id: 'i', status: 'completed', result: 'base64' }],
  EnteredReviewMode: [
    {
      type: 'EnteredReviewMode',
      id: 'i',
      user_facing_hint: 'h',
      target: { type: 'baseBranch', branch: 'main' },
    },
    {
      type: 'EnteredReviewMode',
      id: 'i',
      user_facing_hint: 'h',
      target: { type: 'uncommittedChanges' },
    },
    {
      type: 'EnteredReviewMode',
      id: 'i',
      user_facing_hint: 'h',
      target: { type: 'commit', sha: 's', title: null },
    },
    {
      type: 'EnteredReviewMode',
      id: 'i',
      user_facing_hint: 'h',
      target: { type: 'custom', instructions: 'i' },
    },
  ],
  ExitedReviewMode: [
    { type: 'ExitedReviewMode', id: 'i', review_output: null },
    {
      type: 'ExitedReviewMode',
      id: 'i',
      review_output: {
        findings: [
          {
            title: 't',
            body: 'b',
            confidence_score: 0.5,
            priority: 1,
            code_location: { absolute_file_path: '/a', line_range: { start: 1, end: 2 } },
          },
        ],
        overall_correctness: 'patch is correct',
        overall_explanation: 'e',
        overall_confidence_score: 0.9,
      },
    },
  ],
  FileChange: [
    {
      type: 'FileChange',
      id: 'i',
      status: 'completed',
      auto_approved: true,
      stdout: '',
      stderr: '',
      changes: {
        '/a': { type: 'add', content: 'x' },
        '/b': { type: 'delete', content: 'y' },
        '/c': { type: 'update', unified_diff: '@@', move_path: null },
      },
    },
  ],
  McpToolCall: [
    {
      type: 'McpToolCall',
      id: 'i',
      server: 's',
      tool: 't',
      arguments: {},
      connectorId: 'c',
      mcpAppResourceUri: 'ui://x',
      mcpAppUi: {},
      linkId: 'l',
      appName: 'a',
      actionName: 'n',
      pluginId: 'p',
      readOnlyHint: true,
      status: 'completed',
      result: {
        content: [{ type: 'text', text: 'x' }],
        structuredContent: {},
        isError: false,
        _meta: {},
      },
      error: { message: 'm' },
      duration,
    },
  ],
  ContextCompaction: [{ type: 'ContextCompaction', id: 'i' }],
};

describe('turnItemSchema', () => {
  for (const [type, variants] of Object.entries(items)) {
    it(`parses ${variants.length} ${type} item(s)`, () => {
      for (const item of variants) {
        expect(turnItemSchema.safeParse(item).success).toBe(true);
      }
    });
  }

  it('covers every item type Codex 0.160 can persist', () => {
    expect(Object.keys(items)).toHaveLength(19);
  });

  it('rejects a status or action outside the closed sets', () => {
    for (const item of [
      {
        type: 'CommandExecution',
        id: 'i',
        command: [],
        cwd: '/',
        parsed_cmd: [],
        source: 'agent',
        status: 'paused',
      },
      { type: 'WebSearch', id: 'i', query: 'q', action: { type: 'browse' } },
      { type: 'Extension', kind: 'unknown.kind', id: 'i' },
      { type: 'NotAnItem', id: 'i' },
    ]) {
      expect(turnItemSchema.safeParse(item).success).toBe(false);
    }
  });
});
