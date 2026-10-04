/**
 * Small hand-written rollout fixtures. Every value is invented: nothing here
 * comes from a real session.
 */

const timestamp = '2026-01-02T03:04:05.678Z';
const tokenUsage = {
  input_tokens: 10,
  cached_input_tokens: 4,
  cache_write_input_tokens: 0,
  output_tokens: 3,
  reasoning_output_tokens: 1,
  total_tokens: 13,
};
const metadata = { turn_id: 'turn-1', create_time: 1.5, content_item_kinds: ['user.text'] };

/** One `response_item` payload per `payload.type`. */
export const responseItems = {
  message: {
    type: 'message',
    id: 'msg-1',
    role: 'assistant',
    phase: 'final_answer',
    content: [
      { type: 'output_text', text: 'hello' },
      { type: 'input_text', text: 'hi' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' },
      { type: 'input_audio', audio_url: 'https://example.com/a.wav' },
    ],
    internal_chat_message_metadata_passthrough: metadata,
  },
  agent_message: {
    type: 'agent_message',
    author: '/root',
    recipient: '/root/worker',
    content: [
      { type: 'input_text', text: 'do it' },
      { type: 'encrypted_content', encrypted_content: 'opaque' },
    ],
  },
  reasoning: {
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 'thinking' }],
    content: null,
    encrypted_content: 'opaque',
  },
  local_shell_call: {
    type: 'local_shell_call',
    call_id: 'call-1',
    status: 'completed',
    action: { type: 'exec', command: ['ls'], timeout_ms: null, env: { A: 'b' } },
  },
  function_call: {
    type: 'function_call',
    name: 'exec_command',
    namespace: 'tools',
    arguments: '{"cmd":"ls"}',
    call_id: 'call-1',
  },
  tool_search_call: {
    type: 'tool_search_call',
    call_id: 'call-2',
    status: 'completed',
    execution: 'client',
    arguments: { query: 'files', limit: 5 },
  },
  function_call_output: {
    type: 'function_call_output',
    call_id: 'call-1',
    output: [
      { type: 'input_text', text: 'ok' },
      { type: 'encrypted_content', encrypted_content: 'opaque' },
    ],
    internal_chat_message_metadata_passthrough: {
      ...metadata,
      tool_calls_complete: true,
      executed_tool_calls: [{ name: 'exec_command', arguments: { cmd: 'ls' } }],
    },
  },
  custom_tool_call: {
    type: 'custom_tool_call',
    status: 'completed',
    call_id: 'call-3',
    name: 'apply_patch',
    input: '*** Begin Patch',
  },
  custom_tool_call_output: { type: 'custom_tool_call_output', call_id: 'call-3', output: 'done' },
  tool_search_output: {
    type: 'tool_search_output',
    call_id: 'call-2',
    status: 'completed',
    execution: 'client',
    tools: [
      { type: 'function', name: 'lookup', description: 'Look something up' },
      { type: 'namespace', name: 'group', tools: [{ type: 'function', name: 'inner' }] },
    ],
  },
  web_search_call: {
    type: 'web_search_call',
    status: 'completed',
    action: { type: 'search', query: 'q', queries: ['q'] },
  },
  image_generation_call: {
    type: 'image_generation_call',
    status: 'generating',
    revised_prompt: 'a cat',
    result: 'base64',
  },
  compaction: { type: 'compaction', encrypted_content: 'opaque' },
  compaction_summary: { type: 'compaction_summary', encrypted_content: 'opaque' },
  configuration_update: { type: 'configuration_update', reasoning: { effort: 'low' } },
  context_compaction: { type: 'context_compaction', encrypted_content: null },
  other: { type: 'other' },
} as const;

const goal = {
  threadId: 'thread-1',
  objective: 'ship it',
  status: 'active',
  tokensUsed: 5,
  timeUsedSeconds: 2,
  createdAt: 1,
  updatedAt: 2,
};

const permissionProfile = {
  type: 'managed',
  file_system: {
    type: 'restricted',
    entries: [
      {
        path: { type: 'special', value: { kind: 'project_roots', subpath: '.git' } },
        access: 'read',
      },
      { path: { type: 'path', path: '/tmp/x' }, access: 'write', missing_path_behavior: 'skip' },
    ],
  },
  network: 'restricted',
};

/** One `event_msg` payload per `payload.type`. */
export const eventMessages = {
  item_completed: {
    type: 'item_completed',
    thread_id: 'thread-1',
    turn_id: 'turn-1',
    item: { type: 'ContextCompaction', id: 'item-1' },
    started_at_ms: 1,
    completed_at_ms: 2,
  },
  task_started: {
    type: 'task_started',
    turn_id: 'turn-1',
    model_context_window: null,
    collaboration_mode_kind: 'plan',
  },
  task_complete: {
    type: 'task_complete',
    turn_id: 'turn-1',
    last_agent_message: null,
    error: { message: 'limit', codex_error_info: 'usage_limit_exceeded' },
  },
  token_count: {
    type: 'token_count',
    info: {
      total_token_usage: tokenUsage,
      last_token_usage: tokenUsage,
      model_context_window: 100,
    },
    rate_limits: {
      limit_id: 'codex',
      limit_name: null,
      primary: { used_percent: 1.5, window_minutes: 300, resets_at: 1 },
      secondary: null,
      credits: { has_credits: false, unlimited: false, balance: null },
      individual_limit: null,
      spend_control_reached: null,
      plan_type: 'pro',
      rate_limit_reached_type: null,
    },
  },
  turn_aborted: { type: 'turn_aborted', turn_id: 'turn-1', reason: 'interrupted', duration_ms: 3 },
  thread_goal_updated: { type: 'thread_goal_updated', threadId: 'thread-1', goal },
  thread_settings_applied: {
    type: 'thread_settings_applied',
    thread_settings: {
      model: 'gpt-5.5',
      model_provider_id: 'openai',
      approval_policy: 'never',
      approvals_reviewer: 'user',
      permission_profile: permissionProfile,
      cwd: '/work',
      reasoning_effort: 'medium',
      personality: 'pragmatic',
      collaboration_mode: {
        mode: 'default',
        settings: { model: 'gpt-5.5', reasoning_effort: null, developer_instructions: null },
      },
    },
  },
  thread_rolled_back: { type: 'thread_rolled_back', num_turns: 2 },
  user_message: { type: 'user_message' },
  agent_message: { type: 'agent_message' },
  agent_reasoning: { type: 'agent_reasoning' },
  agent_reasoning_raw_content: { type: 'agent_reasoning_raw_content' },
  entered_review_mode: { type: 'entered_review_mode' },
  exited_review_mode: { type: 'exited_review_mode' },
  patch_apply_end: { type: 'patch_apply_end' },
  context_compacted: { type: 'context_compacted' },
  mcp_tool_call_end: { type: 'mcp_tool_call_end' },
  web_search_end: { type: 'web_search_end' },
  image_generation_end: { type: 'image_generation_end' },
  sub_agent_activity: { type: 'sub_agent_activity' },
} as const;

/** The payloads of the record types that are not `response_item` or `event_msg`. */
export const otherPayloads = {
  session_meta: {
    id: 'thread-1',
    timestamp,
    cwd: '/work',
    originator: 'codex_exec',
    cli_version: '0.160.0',
    source: { subagent: { thread_spawn: { parent_thread_id: 'thread-0', depth: 1 } } },
    thread_source: 'automation',
    model_provider: 'openai',
    base_instructions: { text: 'be helpful', provenance: { type: 'model', model: 'gpt-5.5' } },
    dynamic_tools: [
      {
        type: 'namespace',
        name: 'group',
        description: 'A namespace',
        tools: [{ type: 'function', name: 'f', description: 'd', inputSchema: {} }],
      },
    ],
    history_mode: 'paginated',
    git: { branch: 'main' },
  },
  turn_context: {
    cwd: '/work',
    approval_policy: {
      granular: { sandbox_approval: true, rules: false, mcp_elicitations: true },
    },
    sandbox_policy: { type: 'workspace-write', network_access: true },
    model: 'gpt-5.5',
    multi_agent_mode: 'proactive',
    effort: 'high',
    summary: 'auto',
    file_system_sandbox_policy: { kind: 'restricted', entries: [] },
  },
  token_usage_record: {
    thread_id: 'thread-1',
    turn_id: 'turn-1',
    session_id: 'session-1',
    root_turn_id: 'turn-1',
    response_id: 'resp-1',
    usage: tokenUsage,
    turn_token_usage: tokenUsage,
    thread_token_usage: tokenUsage,
  },
  world_state: {
    full: true,
    state: {
      collaboration_mode: { mode: 'default', model: 'gpt-5.5' },
      environments: {
        environments: { local: { cwd: '/work', shell: 'zsh', status: 'available' } },
      },
      permissions: { approved_command_prefixes: [['git', 'status']] },
      personality: null,
    },
  },
  inter_agent_communication_metadata: { trigger_turn: true },
  inter_agent_communication: {
    author: '/root',
    recipient: '/root/worker',
    content: 'go',
    trigger_turn: false,
  },
  compacted: {
    message: '',
    replacement_history: [responseItems.compaction, responseItems.other],
    guardian_history: [
      { ...responseItems.compaction, guardian_metadata: { client_authored: false } },
    ],
    retained_context: { verified_answers: [], incomplete: false, user_messages: [] },
    latest_token_usage_record: null,
    resume_metadata: {
      multi_agent_version: 'v2',
      last_started_turn_id: null,
      previous_turn_settings: null,
    },
  },
  retained_context: { anything: 'goes' },
  security_risk_score: { scores: { exfiltration: 0.1 } },
  realtime_item: { anything: 'goes' },
} as const;
