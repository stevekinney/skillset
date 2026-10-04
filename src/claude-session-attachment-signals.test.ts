import { describe, expect, it } from 'bun:test';

import {
  claudeSessionAttachmentSchema,
  claudeSessionUnobservedAttachmentTypes,
} from './claude-session-attachment-schemas.js';

const hook = { hookEvent: 'PostToolUse', hookName: 'PostToolUse:Edit', toolUseID: 't-1' };

/** One hand-written body per signal-reporting attachment type. */
const bodies: Record<string, Record<string, unknown>> = {
  auto_mode: {
    autoModeConsentFlow: false,
    bashFirst: true,
    bashFirstSteer: 'relaxed',
    bypass: false,
    steerOnly: true,
  },
  auto_mode_exit: { bashFirst: true, steerOnly: true },
  bash_output_audience_note: { toolUseID: 't-1' },
  batching_reminder_sent: { clearAt: 'next_user_message', model: 'm', text: 't' },
  command_permissions: { allowedTools: ['Bash(ls:*)'] },
  goal_status: {
    condition: 'c',
    met: false,
    durationMs: 1,
    iterations: 2,
    reason: 'r',
    sentinel: true,
    tokens: 3,
  },
  hook_additional_context: { ...hook, content: ['more'] },
  hook_cancelled: { ...hook, command: 'c', durationMs: 1, timedOut: true, timeoutMs: 100 },
  hook_non_blocking_error: {
    ...hook,
    command: 'c',
    durationMs: 1,
    exitCode: 1,
    stderr: 'e',
    stdout: '',
  },
  hook_success: {
    ...hook,
    command: 'c',
    content: 'ok',
    durationMs: 1,
    exitCode: 0,
    stderr: '',
    stdout: 'o',
  },
  plan_file_reference: { planContent: 'p', planFilePath: '/plan.md' },
  plan_mode: {
    isSubAgent: false,
    planExists: true,
    planFilePath: '/plan.md',
    reminderType: 'full',
  },
  plan_mode_exit: { planExists: true, planFilePath: '/plan.md' },
  queued_command: {
    prompt: [{ type: 'text', text: 'go' }],
    commandMode: 'task-notification',
    delivery_id: 'd-1',
    humanTurn: true,
    isMeta: true,
    origin: { kind: 'peer', from: 'uds:/tmp/x.sock', fromMode: 'bypass', hopChain: ['h'] },
    reminderId: 'r-1',
    source_uuid: 'u-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    usage: { durationMs: 1, toolUses: 2, totalTokens: 3 },
  },
  read_truncation_notice: { banner: 'b', toolUseID: 't-1' },
  remote_session_change: {
    commit: '',
    pr: '',
    url: null,
    sendUserFileHint: false,
    managedCommit: false,
    managedPr: false,
  },
  silent_turn_reminder: { text: 't' },
  task_reminder: {
    itemCount: 1,
    content: [
      {
        id: '1',
        subject: 's',
        description: 'd',
        activeForm: 'a',
        status: 'in_progress',
        blocks: [],
        blockedBy: ['2'],
      },
    ],
  },
  task_status: {
    description: 'd',
    deltaSummary: null,
    outputFilePath: '/o.log',
    status: 'running',
    taskId: 'k-1',
    taskType: 'local_bash',
    shell: { command: 'sleep 1', kind: 'monitor', toolUseId: 't-1' },
  },
  thinking_drop: {
    blockHashes: ['h'],
    firstReportForThreadInProcess: true,
    model: 'm',
    querySource: 'sdk',
    requestId: 'req-1',
    thinkingBlocksSent: 1,
    thinkingTurnsSent: 1,
    clientChange: {
      baseline: 'memory',
      callNumber: 1,
      firstChangedMessageIndex: 0,
      kinds: 'messagesHistoryChanged,modelChanged',
    },
    newlyDropped: {
      blockCount: 2,
      turnCount: 1,
      reason: 'prefix_mismatch',
      first: { messageIndex: 0, blockIndex: 0 },
      last: { messageIndex: 3, blockIndex: 1 },
      reasonCounts: { prefix_mismatch: 2, model_mismatch: 1 },
    },
  },
  thinking_stripped: { scope: 'all' },
  total_tokens_reminder: { text: 't' },
  ultra_effort_enter: { reminderType: 'sparse' },
  ultrathink_effort: {},
};

describe('signal attachments', () => {
  for (const [type, body] of Object.entries(bodies)) {
    it(`parses a ${type} attachment`, () => {
      expect(claudeSessionAttachmentSchema.safeParse({ type, ...body }).success).toBe(true);
    });
  }

  it('does not overlap the types accepted by tag alone', () => {
    for (const type of claudeSessionUnobservedAttachmentTypes)
      expect(Object.keys(bodies)).not.toContain(type);
  });

  it('rejects a bad hook event, task status and reminder type', () => {
    const bad = (type: string, patch: Record<string, unknown>) =>
      claudeSessionAttachmentSchema.safeParse({ type, ...bodies[type], ...patch }).success;
    expect(bad('hook_success', { hookEvent: 'NotAnEvent' })).toBe(false);
    expect(bad('task_status', { status: 'exploded' })).toBe(false);
    expect(bad('plan_mode', { reminderType: 'huge' })).toBe(false);
  });
});
