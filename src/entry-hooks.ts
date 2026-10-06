/**
 * Hook payload schemas, parsers, type guards, and types for Claude Code and Codex hook scripts.
 *
 * A subset of the package root for code that only needs this area. Every name
 * here is also exported from the root, as the same value.
 */
export {
  claudeHookInputSchema,
  claudeHookInputSchemas,
  parseClaudeHookInput,
  safeParseClaudeHookInput,
  type ClaudeHookInput,
  type ClaudeHookInputFor,
} from './claude-hook-input-schemas.js';
export {
  claudeAsyncHookOutputSchema,
  claudeHookOutputOrAsyncSchema,
  type ClaudeHookOutputOrAsync,
  claudeHookOutputSchema,
  claudeHookSpecificOutputSchema,
  type ClaudeHookSpecificOutput,
  claudeHookSpecificOutputSchemas,
  parseClaudeHookOutput,
  safeParseClaudeHookOutput,
  type ClaudeAsyncHookOutput,
  type ClaudeHookOutput,
} from './claude-hook-output-schemas.js';
export {
  claudeCommonHookInputSchema,
  type ClaudeCommonHookInput,
  claudeHookEventNames,
  claudePermissionUpdateSchema,
  claudeStopFailureErrors,
  type ClaudeHookEventName,
  type ClaudePermissionUpdate,
} from './claude-hook-shared.js';
export {
  codexHookEventNames,
  codexHookInputSchema,
  codexHookInputSchemas,
  codexHookOutputSchemas,
  parseCodexHookInput,
  parseCodexHookOutput,
  safeParseCodexHookInput,
  safeParseCodexHookOutput,
  type CodexHookEventName,
  type CodexHookInput,
  type CodexHookInputFor,
  type CodexHookOutput,
  type CodexHookOutputFor,
} from './codex-hook-payloads.js';
export {
  isClaudeHookInput,
  isClaudeHookInputFor,
  isClaudeHookOutput,
  isCodexHookInput,
  isCodexHookInputFor,
  isCodexHookOutputFor,
} from './type-guards.js';
