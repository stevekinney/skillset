import { z } from 'zod';

/**
 * The `export const meta = {...}` block that begins every Claude Code workflow
 * script. Claude Code reads it without running the script; the source-level
 * rules (pure literal, first statement) are enforced by
 * `parseClaudeWorkflowMeta` in `claude-workflow-source.ts`.
 *
 * Mirrors the runtime's own normalization: `name` and `description` are
 * required non-empty strings, and unknown keys are ignored (kept here, so a
 * script author can see a typo in a key the runtime silently drops).
 */

/** The largest workflow script Claude Code accepts, in bytes (512 KiB). */
export const claudeWorkflowMaximumScriptBytes = 524_288;

/** One `meta.phases` entry. `title` must match a `phase()` call exactly. */
export const claudeWorkflowPhaseSchema = z.looseObject({
  title: z.string(),
  detail: z.string().optional(),
  // A model override for the phase, shown in the progress view.
  model: z.string().optional(),
});
export type ClaudeWorkflowPhase = z.infer<typeof claudeWorkflowPhaseSchema>;

/** A workflow script's `meta` block. */
export const claudeWorkflowMetaSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
  /** A display title. An empty string is dropped by the runtime. */
  title: z.string().optional(),
  /** Shown in the workflow list, to say when to pick this workflow. */
  whenToUse: z.string().optional(),
  phases: z.array(claudeWorkflowPhaseSchema).optional(),
});
export type ClaudeWorkflowMeta = z.infer<typeof claudeWorkflowMetaSchema>;

/** Keys the runtime refuses in `meta` (and in any nested literal) to block prototype pollution. */
export const claudeWorkflowReservedMetaKeys: readonly string[] = [
  '__proto__',
  'constructor',
  'prototype',
];
