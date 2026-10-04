import { z } from 'zod';

import { claudeSessionUserContentBlockSchema } from './claude-session-content-blocks.js';
import { claudeSessionUsageSchema } from './claude-session-message-schemas.js';
import { claudeSessionAgentColors, looseRecord } from './claude-session-shared.js';

/**
 * `toolUseResult` on a `user` record: the structured result of the tool call
 * whose `tool_result` block that record carries. The record does not name the
 * tool, so the variants below are told apart by the fields each requires.
 *
 * Modelled: Bash (foreground, background, with edit diffs and git
 * operations), Edit, Write, Read, Glob, Grep, WebFetch, WebSearch, ToolSearch,
 * Agent (async launch, completion, teammate spawn), TaskOutput, TaskStop,
 * Workflow, Skill, ScheduleWakeup and Monitor results.
 *
 * Left loose (`looseRecord`): results of every MCP tool (each server defines
 * its own), of the task, team and messaging tools (TaskCreate, TaskUpdate,
 * SendMessage, ListAgents, AskUserQuestion, EnterWorktree, ...), and any tool
 * this schema has not caught up with. Their shapes are either owned by
 * third parties or small, unstable and not worth freezing here.
 */

const stringList = z.array(z.string());

/** One hunk of a unified diff, as `structuredPatch` and `bashEditDiff` carry it. */
const patchHunk = z.looseObject({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: stringList,
});

const gitOperation = z.looseObject({
  branch: z.looseObject({ action: z.enum(['merged', 'rebased']), ref: z.string() }).optional(),
  commit: z
    .looseObject({
      kind: z.enum(['committed', 'cherry-picked', 'amended']),
      sha: z.string(),
      branch: z.string().optional(),
    })
    .optional(),
  pr: z
    .looseObject({
      action: z.enum(['created', 'edited', 'commented', 'closed', 'merged', 'reopened']),
      number: z.number(),
      url: z.string().optional(),
    })
    .optional(),
  push: z.looseObject({ branch: z.string() }).optional(),
});

const bashEditDiff = z.looseObject({
  files: z.array(
    z.looseObject({
      filePath: z.string(),
      hunks: z.array(patchHunk),
      created: z.boolean().optional(),
      deleted: z.boolean().optional(),
    }),
  ),
  moreFiles: z.number(),
  changedFiles: stringList.optional(),
  shared: z.boolean().optional(),
  unavailable: z.boolean().optional(),
});

const bashResult = z.looseObject({
  stdout: z.string(),
  stderr: z.string(),
  interrupted: z.boolean(),
  isImage: z.boolean(),
  noOutputExpected: z.boolean(),
  backgroundCwdHint: z.string().optional(),
  backgroundTaskId: z.string().optional(),
  bashEditDiff: bashEditDiff.optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
  ghRateLimitHint: z.string().optional(),
  gitOperation: gitOperation.optional(),
  persistedOutputPath: z.string().optional(),
  persistedOutputSize: z.number().optional(),
  returnCodeInterpretation: z.string().optional(),
  staleReadFileStateHint: z.string().optional(),
  timedOutAfterMs: z.number().optional(),
});

const editResult = z.looseObject({
  filePath: z.string(),
  oldString: z.string(),
  newString: z.string(),
  originalFile: z.string().nullable(),
  replaceAll: z.boolean(),
  structuredPatch: z.array(patchHunk),
  userModified: z.boolean(),
  contentNotInModelContext: z.boolean().optional(),
  memdirStamped: z.boolean().optional(),
  staleRecovered: z.boolean().optional(),
});

const writeResult = z.looseObject({
  type: z.enum(['create', 'update']),
  filePath: z.string(),
  content: z.string(),
  originalFile: z.string().nullable(),
  structuredPatch: z.array(patchHunk),
  userModified: z.boolean(),
  memdirStamped: z.boolean().optional(),
});

const readResult = z.looseObject({
  type: z.enum(['text', 'image', 'file_unchanged']),
  file: z.looseObject({
    filePath: z.string().optional(),
    content: z.string().optional(),
    numLines: z.number().optional(),
    startLine: z.number().optional(),
    totalLines: z.number().optional(),
    truncatedByTokenCap: z.boolean().optional(),
    base64: z.string().optional(),
    type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']).optional(),
    originalSize: z.number().optional(),
    dimensions: z
      .looseObject({
        displayHeight: z.number(),
        displayWidth: z.number(),
        originalHeight: z.number(),
        originalWidth: z.number(),
      })
      .optional(),
  }),
});

const globResult = z.looseObject({
  filenames: stringList,
  numFiles: z.number(),
  truncated: z.boolean(),
  durationMs: z.number().optional(),
  totalMatches: z.number().optional(),
  countIsComplete: z.boolean().optional(),
});

const grepResult = z.looseObject({
  mode: z.enum(['content', 'files_with_matches', 'count']),
  numFiles: z.number(),
  filenames: stringList,
  appliedLimit: z.number().optional(),
  appliedOffset: z.number().optional(),
  content: z.string().optional(),
  numLines: z.number().optional(),
  numMatches: z.number().optional(),
  totalFiles: z.number().optional(),
  totalLines: z.number().optional(),
});

const webFetchResult = z.looseObject({
  url: z.string(),
  code: z.number(),
  codeText: z.string(),
  bytes: z.number(),
  durationMs: z.number(),
  result: z.string(),
});

const webSearchResult = z.looseObject({
  query: z.string(),
  durationSeconds: z.number(),
  searchCount: z.number().optional(),
  // Each entry is a block of search hits or a plain string commentary between blocks.
  results: z.array(
    z.union([
      z.string(),
      z.looseObject({
        tool_use_id: z.string(),
        content: z.array(z.looseObject({ title: z.string(), url: z.string() })),
      }),
    ]),
  ),
});

const toolSearchResult = z.looseObject({
  query: z.string(),
  matches: stringList,
  total_deferred_tools: z.number(),
  failed_mcp_servers: z
    .array(z.looseObject({ name: z.string(), error: z.string(), errorCode: z.string() }))
    .optional(),
});

const taskType = z.enum(['local_bash', 'local_agent', 'local_workflow', 'mcp_task']);

const taskOutputResult = z.looseObject({
  retrieval_status: z.enum(['success', 'timeout', 'not_ready']),
  task: z
    .looseObject({
      task_id: z.string(),
      task_type: taskType,
      status: z.enum(['completed', 'running', 'failed']),
      description: z.string(),
      output: z.string(),
      exitCode: z.number().nullable().optional(),
      isRawTranscript: z.boolean().optional(),
      omitOutputPath: z.boolean().optional(),
      prompt: z.string().optional(),
      result: z.string().optional(),
    })
    .optional(),
});

const taskStopResult = z.looseObject({
  message: z.string(),
  task_id: z.string(),
  task_type: taskType,
  command: z.string().optional(),
});

const agentResult = z.looseObject({
  status: z.enum(['async_launched', 'completed', 'teammate_spawned']),
  agentId: z.string().optional(),
  agentType: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  isAsync: z.boolean().optional(),
  canReadOutputFile: z.boolean().optional(),
  outputFile: z.string().optional(),
  resolvedModel: z.string().optional(),
  content: z.array(claudeSessionUserContentBlockSchema).optional(),
  totalDurationMs: z.number().optional(),
  totalTokens: z.number().optional(),
  totalToolUseCount: z.number().optional(),
  harnessNoteCount: z.number().optional(),
  harnessSectionHash: z.string().optional(),
  harnessTailCount: z.number().optional(),
  toolStats: z
    .looseObject({
      bashCount: z.number(),
      editFileCount: z.number(),
      linesAdded: z.number(),
      linesRemoved: z.number(),
      otherToolCount: z.number(),
      readCount: z.number(),
      searchCount: z.number(),
    })
    .optional(),
  usage: claudeSessionUsageSchema.optional(),
  // Teammate spawns report a snake_case roster entry instead.
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  color: z.enum(claudeSessionAgentColors).optional(),
  is_splitpane: z.boolean().optional(),
  model: z.string().optional(),
  name: z.string().optional(),
  plan_mode_required: z.boolean().optional(),
  team_name: z.string().optional(),
  teammate_id: z.string().optional(),
  tmux_pane_id: z.string().optional(),
  tmux_session_name: z.string().optional(),
  tmux_window_name: z.string().optional(),
});

const workflowResult = z.looseObject({
  status: z.literal('async_launched'),
  taskType: z.literal('local_workflow'),
  taskId: z.string(),
  runId: z.string(),
  scriptPath: z.string(),
  summary: z.string(),
  transcriptDir: z.string(),
  workflowName: z.string(),
});

const skillResult = z.looseObject({
  success: z.boolean(),
  commandName: z.string(),
  allowedTools: stringList.optional(),
});

const scheduleWakeupResult = z.looseObject({
  scheduledFor: z.number(),
  clampedDelaySeconds: z.number(),
  wasClamped: z.boolean(),
  // Set when the call replaced earlier wakeups.
  cancelledWakeups: z.number().optional(),
  stopped: z.boolean().optional(),
});

const monitorResult = z.looseObject({
  taskId: z.string(),
  timeoutMs: z.number(),
  persistent: z.boolean(),
});

/**
 * The structured result of a tool call: an error or message string, a list of
 * content blocks (MCP results), or one of the object shapes above.
 */
export const claudeSessionToolUseResultSchema = z.union([
  z.string(),
  z.array(claudeSessionUserContentBlockSchema),
  bashResult,
  editResult,
  writeResult,
  readResult,
  globResult,
  grepResult,
  webFetchResult,
  webSearchResult,
  toolSearchResult,
  // Before `agentResult`, which would otherwise take a workflow launch for an agent launch.
  workflowResult,
  agentResult,
  taskOutputResult,
  taskStopResult,
  skillResult,
  scheduleWakeupResult,
  monitorResult,
  looseRecord,
]);
export type ClaudeSessionToolUseResult = z.infer<typeof claudeSessionToolUseResultSchema>;
