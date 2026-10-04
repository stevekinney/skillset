import { describe, expect, it } from 'bun:test';

import {
  claudeWorkflowAgentOptionsSchema,
  claudeWorkflowEffortSchema,
  claudeWorkflowIsolationSchema,
  claudeWorkflowOutputSchemaSchema,
} from './claude-workflow-agent-options.js';
import { claudeWorkflowGlobalNames } from './claude-workflow-globals.js';
import {
  claudeWorkflowMaximumScriptBytes,
  claudeWorkflowMetaSchema,
  claudeWorkflowPhaseSchema,
} from './claude-workflow-meta.js';
import {
  claudeWorkflowProgressRowSchema,
  claudeWorkflowRunRecordSchema,
} from './claude-workflow-run-record.js';
import {
  claudeWorkflowBudgetSchema,
  claudeWorkflowDefaultConcurrency,
  claudeWorkflowReferenceSchema,
  claudeWorkflowRunIdSchema,
  claudeWorkflowToolInputSchema,
  claudeWorkflowToolOutputSchema,
} from './claude-workflow-tool.js';

describe('claudeWorkflowMetaSchema', () => {
  it('accepts a minimal and a full meta block', () => {
    expect(claudeWorkflowMetaSchema.safeParse({ name: 'a', description: 'b' }).success).toBe(true);
    const full = {
      name: 'audit',
      description: 'Audit routes',
      title: 'Audit',
      whenToUse: 'Before a release',
      phases: [{ title: 'Scan', detail: 'find files', model: 'sonnet' }, { title: 'Fix' }],
    };
    expect(claudeWorkflowMetaSchema.parse(full)).toEqual(full);
  });

  it('requires a non-empty name and description', () => {
    expect(claudeWorkflowMetaSchema.safeParse({ description: 'b' }).success).toBe(false);
    expect(claudeWorkflowMetaSchema.safeParse({ name: '', description: 'b' }).success).toBe(false);
    expect(claudeWorkflowMetaSchema.safeParse({ name: 'a', description: '' }).success).toBe(false);
  });

  it('rejects a phase without a title and keeps unknown keys', () => {
    expect(claudeWorkflowPhaseSchema.safeParse({ detail: 'x' }).success).toBe(false);
    expect(
      claudeWorkflowMetaSchema.parse({ name: 'a', description: 'b', extra: 1 }),
    ).toHaveProperty('extra', 1);
  });

  it('documents the script size cap', () => {
    expect(claudeWorkflowMaximumScriptBytes).toBe(512 * 1024);
  });
});

describe('claudeWorkflowAgentOptionsSchema', () => {
  it('accepts every documented option', () => {
    const options = {
      label: 'review',
      phase: 'Review',
      model: 'opus',
      effort: 'xhigh',
      isolation: 'worktree',
      agentType: 'general-purpose',
      schema: { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] },
      disallowedTools: ['Bash', 'Write'],
      bashCommandClamp: ['Bash(git status)'],
      stallMs: 60_000,
    };
    expect(claudeWorkflowAgentOptionsSchema.safeParse(options).success).toBe(true);
    expect(claudeWorkflowAgentOptionsSchema.safeParse({}).success).toBe(true);
  });

  it('closes the effort and isolation unions', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'])
      expect(claudeWorkflowEffortSchema.safeParse(effort).success).toBe(true);
    expect(claudeWorkflowEffortSchema.safeParse('extreme').success).toBe(false);
    expect(claudeWorkflowIsolationSchema.safeParse('worktree').success).toBe(true);
    expect(claudeWorkflowIsolationSchema.safeParse('remote').success).toBe(false);
    expect(claudeWorkflowAgentOptionsSchema.safeParse({ effort: 5 }).success).toBe(false);
  });

  it('rejects malformed tool lists', () => {
    expect(claudeWorkflowAgentOptionsSchema.safeParse({ disallowedTools: [''] }).success).toBe(
      false,
    );
    expect(
      claudeWorkflowAgentOptionsSchema.safeParse({ bashCommandClamp: ['Write(x)'] }).success,
    ).toBe(false);
  });
});

describe('claudeWorkflowOutputSchemaSchema', () => {
  it('requires an object root with properties', () => {
    const ok = { type: 'object', properties: {} };
    expect(claudeWorkflowOutputSchemaSchema.safeParse(ok).success).toBe(true);
    expect(claudeWorkflowOutputSchemaSchema.safeParse({ type: 'string' }).success).toBe(false);
    expect(claudeWorkflowOutputSchemaSchema.safeParse({ type: 'object' }).success).toBe(false);
  });

  it('rejects a required key missing from properties', () => {
    const plain = claudeWorkflowOutputSchemaSchema.safeParse({
      type: 'object',
      properties: { a: {} },
      required: ['a', 'b'],
    });
    expect(plain.success).toBe(false);
    expect(plain.error?.issues[0]?.message).toBe('required key "b" is not in properties');

    const closed = claudeWorkflowOutputSchemaSchema.safeParse({
      type: 'object',
      properties: {},
      required: ['b'],
      additionalProperties: false,
    });
    expect(closed.error?.issues[0]?.message).toContain('additionalProperties: false');
  });

  it('accepts a schema-valued additionalProperties and nested keywords', () => {
    expect(
      claudeWorkflowOutputSchemaSchema.safeParse({
        type: 'object',
        properties: { a: { enum: ['x'] } },
        additionalProperties: { type: 'string' },
        $defs: {},
      }).success,
    ).toBe(true);
  });
});

describe('Workflow tool schemas', () => {
  it('accepts script, scriptPath, or name, and ignores description and title', () => {
    expect(claudeWorkflowToolInputSchema.safeParse({ script: 'x' }).success).toBe(true);
    expect(claudeWorkflowToolInputSchema.safeParse({ scriptPath: '/a/b.js' }).success).toBe(true);
    expect(
      claudeWorkflowToolInputSchema.safeParse({
        name: 'deep-research',
        args: ['a'],
        description: 'ignored',
        title: 'ignored',
        resumeFromRunId: 'wf_abc123-1',
      }).success,
    ).toBe(true);
  });

  it('requires one way to name the script', () => {
    const result = claudeWorkflowToolInputSchema.safeParse({ args: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Must provide script, name, or scriptPath');
  });

  it('rejects an oversized script, hidden characters, and a bad run id', () => {
    const big = 'x'.repeat(claudeWorkflowMaximumScriptBytes + 1);
    expect(claudeWorkflowToolInputSchema.safeParse({ script: big }).success).toBe(false);
    expect(claudeWorkflowToolInputSchema.safeParse({ name: 'a​b' }).success).toBe(false);
    expect(claudeWorkflowToolInputSchema.safeParse({ scriptPath: 'a\nb' }).success).toBe(false);
    expect(claudeWorkflowRunIdSchema.safeParse('wf_abc').success).toBe(false);
    expect(claudeWorkflowRunIdSchema.safeParse('run_abc123').success).toBe(false);
    expect(claudeWorkflowRunIdSchema.safeParse('wf_f2a82f43-468').success).toBe(true);
  });

  it('validates the tool output', () => {
    expect(
      claudeWorkflowToolOutputSchema.safeParse({
        status: 'async_launched',
        taskId: 't1',
        taskType: 'local_workflow',
        workflowName: 'audit',
        runId: 'wf_abc123',
        transcriptDir: '/tmp/x',
        scriptPath: '/tmp/x.js',
      }).success,
    ).toBe(true);
    expect(claudeWorkflowToolOutputSchema.safeParse({ status: 'done', taskId: 't' }).success).toBe(
      false,
    );
  });

  it('validates a workflow() reference', () => {
    expect(claudeWorkflowReferenceSchema.safeParse('saved-name').success).toBe(true);
    expect(claudeWorkflowReferenceSchema.safeParse({ scriptPath: '/a.js' }).success).toBe(true);
    expect(claudeWorkflowReferenceSchema.safeParse({ name: 'x' }).success).toBe(false);
  });

  it('validates the budget shape', () => {
    const budget = { total: null, spent: () => 0, remaining: () => Infinity };
    expect(claudeWorkflowBudgetSchema.safeParse(budget).success).toBe(true);
    expect(claudeWorkflowBudgetSchema.safeParse({ ...budget, total: 500_000 }).success).toBe(true);
    expect(claudeWorkflowBudgetSchema.safeParse({ ...budget, spent: 0 }).success).toBe(false);
  });

  it('computes the default concurrency', () => {
    expect(claudeWorkflowDefaultConcurrency(1)).toBe(2);
    expect(claudeWorkflowDefaultConcurrency(8)).toBe(6);
    expect(claudeWorkflowDefaultConcurrency(64)).toBe(16);
  });
});

describe('workflow run record', () => {
  const agentRow = {
    type: 'workflow_agent',
    index: 1,
    label: 'scan',
    state: 'done',
    phaseIndex: 0,
    phaseTitle: 'Scan',
    model: 'claude-sonnet-5',
    lastProgressAt: 10,
    promptPreview: 'p',
    tokens: 5,
  };
  const record = {
    runId: 'wf_abc123',
    taskId: 't',
    timestamp: '2026-10-04T00:00:00Z',
    startTime: 1,
    durationMs: 2,
    status: 'completed',
    workflowName: 'audit',
    summary: 's',
    script: 'x',
    scriptPath: '/a.js',
    result: { ok: true },
    agentCount: 1,
    totalTokens: 5,
    totalToolCalls: 0,
    defaultModel: 'm',
    logs: [],
    phases: [{ title: 'Scan' }],
    workflowProgress: [{ type: 'workflow_phase', index: 0, title: 'Scan' }, agentRow],
  };

  it('parses a finished run and its progress rows', () => {
    expect(claudeWorkflowRunRecordSchema.safeParse(record).success).toBe(true);
    expect(
      claudeWorkflowRunRecordSchema.safeParse({
        ...record,
        status: 'killed',
        error: 'x',
        args: [1],
      }).success,
    ).toBe(true);
    expect(claudeWorkflowProgressRowSchema.safeParse(agentRow).success).toBe(true);
    for (const lastAttemptReason of ['stalled', 'throttled', 'user-retry'])
      expect(
        claudeWorkflowProgressRowSchema.safeParse({
          ...agentRow,
          lastAttemptReason,
          fallbackModel: 'm',
        }).success,
      ).toBe(true);
    expect(
      claudeWorkflowProgressRowSchema.safeParse({ ...agentRow, lastAttemptReason: 'other' })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown status, row type, or agent state', () => {
    expect(claudeWorkflowRunRecordSchema.safeParse({ ...record, status: 'running' }).success).toBe(
      false,
    );
    expect(claudeWorkflowProgressRowSchema.safeParse({ type: 'workflow_log' }).success).toBe(false);
    expect(claudeWorkflowProgressRowSchema.safeParse({ ...agentRow, state: 'x' }).success).toBe(
      false,
    );
  });
});

describe('claudeWorkflowGlobalNames', () => {
  it('lists every global a script receives', () => {
    expect([...claudeWorkflowGlobalNames].map(String).toSorted()).toEqual(
      ['agent', 'args', 'budget', 'log', 'parallel', 'phase', 'pipeline', 'workflow'].toSorted(),
    );
  });
});

describe('disallowedTools names', () => {
  it('rejects a name that is empty once trimmed', () => {
    expect(claudeWorkflowAgentOptionsSchema.safeParse({ disallowedTools: ['   '] }).success).toBe(
      false,
    );
    expect(
      claudeWorkflowAgentOptionsSchema.safeParse({ disallowedTools: [' Bash '] }).success,
    ).toBe(true);
  });
});
