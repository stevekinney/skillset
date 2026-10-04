import { z } from 'zod';

import { claudeWorkflowPhaseSchema } from './claude-workflow-meta.js';

/**
 * The `wf_<id>.json` file Claude Code writes beside a session's
 * `workflows/scripts/` directory when a run ends: the script, its result, and
 * the progress rows the `/workflows` view shows. The per-agent journal is a
 * different file, covered by `claudeWorkflowJournalRecordSchema`.
 */

const progressRowBase = { index: z.number().int() };

/** A phase row in a run's progress. */
export const claudeWorkflowProgressPhaseSchema = z.looseObject({
  type: z.literal('workflow_phase'),
  ...progressRowBase,
  title: z.string(),
});
export type ClaudeWorkflowProgressPhase = z.infer<typeof claudeWorkflowProgressPhaseSchema>;

/** An agent row in a run's progress. */
export const claudeWorkflowProgressAgentSchema = z.looseObject({
  type: z.literal('workflow_agent'),
  ...progressRowBase,
  label: z.string(),
  state: z.enum(['start', 'progress', 'done', 'error']),
  phaseIndex: z.number().int(),
  phaseTitle: z.string(),
  model: z.string(),
  agentId: z.string().optional(),
  agentType: z.string().optional(),
  isolation: z.literal('worktree').optional(),
  attempt: z.number().int().optional(),
  cached: z.boolean().optional(),
  promptFramed: z.boolean().optional(),
  durationMs: z.number().optional(),
  queuedAt: z.number().optional(),
  startedAt: z.number().optional(),
  lastProgressAt: z.number(),
  lastToolName: z.string().optional(),
  lastToolSummary: z.string().optional(),
  /** Why the agent is on a later attempt: it stalled, hit a rate limit, or the user retried it. */
  lastAttemptReason: z.enum(['stalled', 'throttled', 'user-retry']).optional(),
  /** The model an agent fell back to, when its own was unavailable. */
  fallbackModel: z.string().optional(),
  promptPreview: z.string(),
  resultPreview: z.string().optional(),
  error: z.string().optional(),
  tokens: z.number().optional(),
  toolCalls: z.number().optional(),
});
export type ClaudeWorkflowProgressAgent = z.infer<typeof claudeWorkflowProgressAgentSchema>;

/** One row of a run's progress: a phase, or an agent. */
export const claudeWorkflowProgressRowSchema = z.discriminatedUnion('type', [
  claudeWorkflowProgressPhaseSchema,
  claudeWorkflowProgressAgentSchema,
]);
export type ClaudeWorkflowProgressRow = z.infer<typeof claudeWorkflowProgressRowSchema>;

/** A finished run's `wf_<id>.json`. `result` is whatever the script returned. */
export const claudeWorkflowRunRecordSchema = z.looseObject({
  runId: z.string(),
  taskId: z.string(),
  timestamp: z.string(),
  startTime: z.number(),
  durationMs: z.number(),
  status: z.enum(['completed', 'failed', 'killed', 'paused']),
  workflowName: z.string(),
  summary: z.string(),
  script: z.string(),
  scriptPath: z.string(),
  /** The Workflow tool's `args`, verbatim. */
  args: z.unknown().optional(),
  result: z.unknown(),
  /** Set when the run failed or was killed. */
  error: z.string().optional(),
  agentCount: z.number().int(),
  totalTokens: z.number(),
  totalToolCalls: z.number(),
  defaultModel: z.string(),
  logs: z.array(z.string()),
  phases: z.array(claudeWorkflowPhaseSchema),
  workflowProgress: z.array(claudeWorkflowProgressRowSchema),
});
export type ClaudeWorkflowRunRecord = z.infer<typeof claudeWorkflowRunRecordSchema>;
