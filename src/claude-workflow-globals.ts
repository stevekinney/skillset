import type { ClaudeWorkflowScriptGlobals } from './claude-workflow-script-api.js';

/**
 * Declares the workflow script globals for the type checker. It is not part of
 * the package's main entry point, because importing it would add `agent`,
 * `pipeline`, and the rest to every consumer's global scope. Reference it from
 * a workflow script instead:
 *
 * ```js
 * // @ts-check
 * /// <reference types="@lostgradient/skillset/workflow-globals" />
 * ```
 */
declare global {
  const agent: ClaudeWorkflowScriptGlobals['agent'];
  const pipeline: ClaudeWorkflowScriptGlobals['pipeline'];
  const parallel: ClaudeWorkflowScriptGlobals['parallel'];
  const phase: ClaudeWorkflowScriptGlobals['phase'];
  const log: ClaudeWorkflowScriptGlobals['log'];
  const workflow: ClaudeWorkflowScriptGlobals['workflow'];
  const args: ClaudeWorkflowScriptGlobals['args'];
  const budget: ClaudeWorkflowScriptGlobals['budget'];
}

/** The names of the globals Claude Code defines for a workflow script. */
export const claudeWorkflowGlobalNames = [
  'agent',
  'pipeline',
  'parallel',
  'phase',
  'log',
  'workflow',
  'args',
  'budget',
] as const satisfies readonly (keyof ClaudeWorkflowScriptGlobals)[];
