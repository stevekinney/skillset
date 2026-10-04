import { describe, expect, it } from 'bun:test';

import {
  claudeWorkflowJournalRecordSchemas,
  parseClaudeWorkflowJournalRecord,
  safeParseClaudeWorkflowJournalRecord,
  type ClaudeWorkflowJournalRecordFor,
} from './claude-session-workflow-journal.js';

const run = { agentId: 'a-1', key: 'k-1' };

describe('claudeWorkflowJournalRecordSchemas', () => {
  it('parses each journal record type', () => {
    expect(parseClaudeWorkflowJournalRecord({ type: 'launched' })).toMatchObject({
      type: 'launched',
    });
    expect(
      parseClaudeWorkflowJournalRecord({ type: 'started', ...run, label: 'l', phase: 'p' }),
    ).toMatchObject({ type: 'started' });
    expect(
      parseClaudeWorkflowJournalRecord({ type: 'result', ...run, result: { ok: true } }),
    ).toMatchObject({ type: 'result' });
    expect(
      parseClaudeWorkflowJournalRecord({ type: 'result', ...run, result: 'text' }),
    ).toMatchObject({ type: 'result' });
    expect(parseClaudeWorkflowJournalRecord({ type: 'failed', ...run })).toMatchObject({
      type: 'failed',
    });
  });

  it('keeps unknown fields and narrows by type', () => {
    const record: ClaudeWorkflowJournalRecordFor<'failed'> =
      claudeWorkflowJournalRecordSchemas.failed.parse({
        type: 'failed',
        ...run,
        later: 1,
      });
    expect(record).toMatchObject({ later: 1 });
  });

  it('rejects an unknown type or a missing field and returns a result from the safe variant', () => {
    expect(safeParseClaudeWorkflowJournalRecord({ type: 'paused' }).success).toBe(false);
    expect(safeParseClaudeWorkflowJournalRecord({ type: 'started' }).success).toBe(false);
    expect(safeParseClaudeWorkflowJournalRecord({ type: 'launched' }).success).toBe(true);
    expect(() => parseClaudeWorkflowJournalRecord({ type: 'result', ...run })).toThrow();
  });
});
