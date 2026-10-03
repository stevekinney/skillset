import { describe, expect, it } from 'bun:test';

import {
  claudeAsyncHookOutputSchema,
  claudeHookOutputSchema,
  claudeHookSpecificOutputSchemas,
  parseClaudeHookOutput,
} from './claude-hook-output-schemas.js';
import { claudePermissionUpdateSchema } from './claude-hook-shared.js';

const safeParseOutput = (value: unknown) => claudeHookOutputSchema.safeParse(value);
const parseOutput = (value: unknown): unknown => claudeHookOutputSchema.parse(value);

describe('Claude hook output schemas', () => {
  it('has 22 hookSpecificOutput variants', () => {
    expect(Object.keys(claudeHookSpecificOutputSchemas)).toHaveLength(22);
  });

  const permissionUpdates = [
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
      behavior: 'allow',
      destination: 'session',
    },
    { type: 'setMode', mode: 'manual', destination: 'userSettings' },
  ];
  const variants: Record<string, Record<string, unknown>> = {
    PreToolUse: { permissionDecision: 'defer', updatedInput: { a: 1 }, additionalContext: 'c' },
    PermissionRequest: { decision: { behavior: 'allow', updatedPermissions: permissionUpdates } },
    PostToolUse: {
      classifierContext: 'c',
      updatedToolOutput: { any: true },
      updatedMCPToolOutput: 1,
    },
    PostToolUseFailure: { additionalContext: 'c' },
    PostToolBatch: { additionalContext: 'c' },
    UserPromptSubmit: { sessionTitle: 't', suppressOriginalPrompt: true },
    UserPromptExpansion: { suppressOriginalPrompt: true },
    SessionStart: { initialUserMessage: 'hi', watchPaths: ['/a'], reloadSkills: true },
    Setup: {},
    SubagentStart: { additionalContext: 'c' },
    Stop: { additionalContext: 'c' },
    SubagentStop: { additionalContext: 'c' },
    PermissionDenied: { retry: true },
    Notification: {},
    Elicitation: { action: 'decline', content: {} },
    ElicitationResult: { action: 'cancel' },
    CwdChanged: { watchPaths: [] },
    FileChanged: { watchPaths: ['/f'] },
    WorktreeCreate: { worktreePath: '/w' },
    MessageDisplay: { displayContent: 'x' },
    PreModelSwitch: { permissionDecision: 'ask', permissionDecisionReason: 'r' },
    PostModelSwitch: { additionalContext: 'c' },
  };

  for (const [name, body] of Object.entries(variants)) {
    it(`accepts the ${name} variant`, () => {
      const output = {
        continue: true,
        hookSpecificOutput: { hookEventName: name, ...body, futureKey: 1 },
      };
      expect(parseOutput(output)).toEqual(output);
    });
  }

  it('accepts the deny arm of the PermissionRequest decision', () => {
    expect(
      safeParseOutput({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: 'no', interrupt: true },
        },
      }).success,
    ).toBe(true);
  });

  it('requires worktreePath on WorktreeCreate and decision on PermissionRequest', () => {
    for (const hookEventName of ['WorktreeCreate', 'PermissionRequest']) {
      expect(safeParseOutput({ hookSpecificOutput: { hookEventName } }).success).toBe(false);
    }
  });

  it('accepts the top-level fields and keeps unknown keys', () => {
    const output = {
      continue: false,
      suppressOutput: true,
      stopReason: 's',
      decision: 'approve',
      reason: 'r',
      systemMessage: 'm',
      terminalSequence: '\u0007',
      metrics: {},
    };
    expect(parseOutput(output)).toEqual(output);
  });

  it('rejects top-level decisions the binary does not accept', () => {
    expect(safeParseOutput({ decision: 'allow' }).success).toBe(false);
  });

  it('rejects a hookSpecificOutput for an event without one', () => {
    expect(safeParseOutput({ hookSpecificOutput: { hookEventName: 'SessionEnd' } }).success).toBe(
      false,
    );
  });

  it('parses the async form and the regular form', () => {
    expect(claudeAsyncHookOutputSchema.parse({ async: true, asyncTimeout: 5 }).async).toBe(true);
    expect(parseClaudeHookOutput({ async: true })).toEqual({ async: true });
    expect(parseClaudeHookOutput({ systemMessage: 'x' })).toEqual({ systemMessage: 'x' });
    expect(() => parseClaudeHookOutput({ decision: 'maybe' })).toThrow();
  });

  it('rejects an unknown permission update type', () => {
    expect(claudePermissionUpdateSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});
