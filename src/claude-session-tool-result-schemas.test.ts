import { describe, expect, it } from 'bun:test';

import { claudeSessionToolUseResultSchema } from './claude-session-tool-result-schemas.js';

const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' a', '+b'] };

/** One hand-written result per shape, each told apart by the fields it requires. */
const results: Record<string, unknown> = {
  string: 'Error: the tool failed',
  contentBlocks: [
    { type: 'text', text: 'a' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
  ],
  bash: {
    stdout: 'out',
    stderr: '',
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
    backgroundTaskId: 'b-1',
    backgroundCwdHint: 'h',
    bashEditDiff: {
      files: [{ filePath: 'a.ts', hunks: [hunk], created: true, deleted: false }],
      moreFiles: 0,
      changedFiles: ['a.ts'],
      shared: true,
      unavailable: false,
    },
    dangerouslyDisableSandbox: true,
    ghRateLimitHint: 'wait',
    gitOperation: {
      branch: { action: 'merged', ref: 'main' },
      commit: { kind: 'committed', sha: 'abc', branch: 'main' },
      pr: { action: 'created', number: 7, url: 'https://example.test/pull/7' },
      push: { branch: 'main' },
    },
    persistedOutputPath: '/tmp/out.txt',
    persistedOutputSize: 10,
    returnCodeInterpretation: 'No matches found',
    staleReadFileStateHint: 'stale',
    timedOutAfterMs: 1000,
  },
  edit: {
    filePath: '/work/a.ts',
    oldString: 'a',
    newString: 'b',
    originalFile: null,
    replaceAll: false,
    structuredPatch: [hunk],
    userModified: false,
    contentNotInModelContext: true,
    memdirStamped: true,
    staleRecovered: true,
  },
  write: {
    type: 'create',
    filePath: '/work/a.ts',
    content: 'x',
    originalFile: 'old',
    structuredPatch: [],
    userModified: false,
    memdirStamped: true,
  },
  readText: {
    type: 'text',
    file: {
      filePath: '/work/a.ts',
      content: 'x',
      numLines: 1,
      startLine: 1,
      totalLines: 1,
      truncatedByTokenCap: true,
    },
  },
  readImage: {
    type: 'image',
    file: {
      base64: 'AAAA',
      type: 'image/png',
      originalSize: 4,
      dimensions: { displayHeight: 1, displayWidth: 1, originalHeight: 2, originalWidth: 2 },
    },
  },
  glob: {
    filenames: ['a'],
    numFiles: 1,
    truncated: false,
    durationMs: 3,
    totalMatches: 1,
    countIsComplete: true,
  },
  grep: {
    mode: 'content',
    numFiles: 1,
    filenames: ['a'],
    content: 'line',
    numLines: 1,
    numMatches: 1,
    totalFiles: 1,
    totalLines: 1,
    appliedLimit: 10,
    appliedOffset: 0,
  },
  webFetch: {
    url: 'https://example.test',
    code: 200,
    codeText: 'OK',
    bytes: 10,
    durationMs: 5,
    result: 'body',
  },
  webSearch: {
    query: 'q',
    durationSeconds: 1,
    searchCount: 1,
    results: [
      'commentary',
      { tool_use_id: 's-1', content: [{ title: 't', url: 'https://example.test' }] },
    ],
  },
  toolSearch: {
    query: 'select:Read',
    matches: ['Read'],
    total_deferred_tools: 3,
    failed_mcp_servers: [{ name: 's', error: 'e', errorCode: 'AUTH_HEADER_REJECTED' }],
  },
  workflow: {
    status: 'async_launched',
    taskType: 'local_workflow',
    taskId: 'k-1',
    runId: 'r-1',
    scriptPath: '/s.ts',
    summary: 's',
    transcriptDir: '/t',
    workflowName: 'w',
  },
  agentLaunch: {
    status: 'async_launched',
    agentId: 'a-1',
    description: 'd',
    prompt: 'p',
    isAsync: true,
    canReadOutputFile: true,
    outputFile: '/o',
  },
  agentCompleted: {
    status: 'completed',
    agentId: 'a-1',
    agentType: 'general-purpose',
    resolvedModel: 'm',
    content: [{ type: 'text', text: 'done' }],
    totalDurationMs: 1,
    totalTokens: 2,
    totalToolUseCount: 3,
    harnessNoteCount: 0,
    harnessSectionHash: 'h',
    harnessTailCount: 0,
    toolStats: {
      bashCount: 1,
      editFileCount: 0,
      linesAdded: 0,
      linesRemoved: 0,
      otherToolCount: 0,
      readCount: 0,
      searchCount: 0,
    },
    usage: {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  },
  agentTeammate: {
    status: 'teammate_spawned',
    agent_id: 'a',
    agent_type: 't',
    color: 'blue',
    is_splitpane: false,
    model: 'm',
    name: 'n',
    plan_mode_required: false,
    team_name: 'team',
    teammate_id: 'x',
    tmux_pane_id: '%1',
    tmux_session_name: 's',
    tmux_window_name: 'w',
  },
  taskOutput: {
    retrieval_status: 'success',
    task: {
      task_id: 'k-1',
      task_type: 'local_agent',
      status: 'completed',
      description: 'd',
      output: 'o',
      exitCode: null,
      isRawTranscript: false,
      omitOutputPath: true,
      prompt: 'p',
      result: 'r',
    },
  },
  taskOutputNotReady: { retrieval_status: 'not_ready' },
  taskStop: { message: 'stopped', task_id: 'k-1', task_type: 'local_bash', command: 'sleep 1' },
  skill: { success: true, commandName: 'chef', allowedTools: ['Bash'] },
  scheduleWakeup: {
    scheduledFor: 1,
    clampedDelaySeconds: 60,
    wasClamped: false,
    cancelledWakeups: 1,
    stopped: true,
  },
  monitor: { taskId: 'k-1', timeoutMs: 1000, persistent: false },
  looseFallback: { anything: ['goes'], here: 1 },
};

describe('claudeSessionToolUseResultSchema', () => {
  for (const [name, result] of Object.entries(results)) {
    it(`parses a ${name} result`, () => {
      expect(claudeSessionToolUseResultSchema.safeParse(result).success).toBe(true);
    });
  }

  it('keeps a field the schema does not name on a modelled shape', () => {
    const parsed = claudeSessionToolUseResultSchema.parse({
      success: true,
      commandName: 'chef',
      later: 1,
    });
    expect(parsed).toMatchObject({ later: 1 });
  });

  it('rejects a value that is neither a string, a list nor an object', () => {
    expect(claudeSessionToolUseResultSchema.safeParse(7).success).toBe(false);
    expect(claudeSessionToolUseResultSchema.safeParse(null).success).toBe(false);
  });

  it('rejects a list of things that are not content blocks', () => {
    expect(claudeSessionToolUseResultSchema.safeParse([1, 2]).success).toBe(false);
  });
});
