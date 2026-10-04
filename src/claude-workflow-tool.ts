import { z } from 'zod';

import { claudeWorkflowMaximumScriptBytes } from './claude-workflow-meta.js';

/**
 * The `Workflow` tool's input and output, the reference `workflow()` accepts,
 * and the `budget` global. The runtime's own limits are exported as constants
 * so a script author or tool can check against them.
 */

/** Items one `parallel()` or `pipeline()` call accepts. A longer list is an error, not a truncation. */
export const claudeWorkflowMaximumItems = 4096;
/** Agents one workflow run may start in total, as a runaway-loop backstop. */
export const claudeWorkflowMaximumAgents = 1000;
/** Concurrent agents by default: `min(16, max(2, availableCpus - 2))`. */
export function claudeWorkflowDefaultConcurrency(availableCpus: number): number {
  return Math.min(16, Math.max(2, availableCpus - 2));
}

/** A run identifier, as `resumeFromRunId` takes it. */
export const claudeWorkflowRunIdSchema = z.string().regex(/^wf_[a-z0-9-]{6,}$/);

/** The tool rejects control and invisible format characters in `name` and `scriptPath`. */
const hasControlCharacters = (value: string) =>
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/u.test(value);
const plainText = z.string().refine((value) => !hasControlCharacters(value), {
  message: 'contains control or invisible format characters',
});

/**
 * The argument of the script's `workflow()`: a saved workflow's name, or a
 * `{ scriptPath }` reference to a script file. Nesting is one level deep.
 */
export const claudeWorkflowReferenceSchema = z.union([
  z.string(),
  z.looseObject({ scriptPath: z.string() }),
]);
export type ClaudeWorkflowReference = z.infer<typeof claudeWorkflowReferenceSchema>;

/**
 * The input of the `Workflow` tool. At least one of `script`, `scriptPath`, or
 * `name` is required; `scriptPath` wins over `script`, which wins over `name`.
 * `description` and `title` are accepted and ignored: the script's `meta` names
 * the run.
 */
export const claudeWorkflowToolInputSchema = z
  .looseObject({
    /** A self-contained script beginning with `export const meta = {...}`. */
    script: z
      .string()
      .refine(
        (value) => new TextEncoder().encode(value).length <= claudeWorkflowMaximumScriptBytes,
        {
          message: `exceeds ${claudeWorkflowMaximumScriptBytes} bytes`,
        },
      )
      .optional(),
    /** A saved workflow (built in, or from a `.claude/workflows/` directory). */
    name: plainText.optional(),
    /** Ignored: set the description in `meta`. */
    description: z.string().optional(),
    /** Ignored: set the title in `meta`. */
    title: z.string().optional(),
    /** The script's `args` global, verbatim. Pass arrays and objects as JSON values, not as a string. */
    args: z.unknown().optional(),
    /** A script file on disk. Every run saves its script and reports the path. */
    scriptPath: plainText.optional(),
    /** A prior run to resume: agents whose prompt and options are unchanged replay from cache. */
    resumeFromRunId: claudeWorkflowRunIdSchema.optional(),
  })
  .refine(
    (input) =>
      input.script !== undefined || input.name !== undefined || input.scriptPath !== undefined,
    { message: 'Must provide script, name, or scriptPath' },
  );
export type ClaudeWorkflowToolInput = z.infer<typeof claudeWorkflowToolInputSchema>;

/** The `Workflow` tool's result when a run starts. */
export const claudeWorkflowToolOutputSchema = z.looseObject({
  status: z.enum(['async_launched', 'remote_launched']),
  taskId: z.string(),
  taskType: z.enum(['local_workflow', 'remote_agent']).optional(),
  /** `meta.name` from the script. */
  workflowName: z.string().optional(),
  /** The `resumeFromRunId` handle. Absent for `remote_launched`. */
  runId: z.string().optional(),
  summary: z.string().optional(),
  /** Where the subagents' transcripts, and the run's `journal.jsonl`, are written. */
  transcriptDir: z.string().optional(),
  scriptPath: z.string().optional(),
  sessionUrl: z.string().optional(),
  warning: z.string().optional(),
  /** Set when the script failed its syntax check. */
  error: z.string().optional(),
});
export type ClaudeWorkflowToolOutput = z.infer<typeof claudeWorkflowToolOutputSchema>;

/** The script's `budget` global. The token target comes from a "+500k"-style directive. */
export const claudeWorkflowBudgetSchema = z.object({
  /** The turn's token target, or `null` when none was set. */
  total: z.number().nullable(),
  /** Output tokens spent this turn across the main loop and every workflow. */
  spent: z.custom<() => number>((value) => typeof value === 'function'),
  /** `max(0, total - spent())`, or `Infinity` when there is no target. */
  remaining: z.custom<() => number>((value) => typeof value === 'function'),
});
export type ClaudeWorkflowBudget = z.infer<typeof claudeWorkflowBudgetSchema>;
