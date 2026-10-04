import { z } from 'zod';

import { looseRecord, sessionRecord } from './claude-session-shared.js';

/**
 * Records in a workflow run's `journal.jsonl`
 * (`<session-id>/subagents/workflows/<workflow>/journal.jsonl`): the log the
 * workflow runtime keeps of each agent it launches. They are not transcript
 * records, and the agents' own transcripts sit beside the journal.
 *
 * Deliberately loose: `result.result`, the value a workflow agent returned,
 * which is whatever the workflow script asked for.
 */

const agentRun = { agentId: z.string(), key: z.string() };

/** Journal record schemas, keyed by `type`. */
export const claudeWorkflowJournalRecordSchemas = {
  launched: sessionRecord('launched', {}),
  started: sessionRecord('started', {
    ...agentRun,
    label: z.string().optional(),
    phase: z.string().optional(),
  }),
  result: sessionRecord('result', {
    ...agentRun,
    // An agent's structured result, or its final text.
    result: z.union([z.string(), looseRecord]),
  }),
  failed: sessionRecord('failed', agentRun),
};

/** Any workflow journal record, discriminated on `type`. */
export const claudeWorkflowJournalRecordSchema = z.discriminatedUnion('type', [
  claudeWorkflowJournalRecordSchemas.launched,
  claudeWorkflowJournalRecordSchemas.started,
  claudeWorkflowJournalRecordSchemas.result,
  claudeWorkflowJournalRecordSchemas.failed,
]);

export type ClaudeWorkflowJournalRecord = z.infer<typeof claudeWorkflowJournalRecordSchema>;
/** One journal record type, for example `ClaudeWorkflowJournalRecordFor<'result'>`. */
export type ClaudeWorkflowJournalRecordFor<
  Type extends keyof typeof claudeWorkflowJournalRecordSchemas,
> = z.infer<(typeof claudeWorkflowJournalRecordSchemas)[Type]>;

/** Parse one journal record. Throws a `ZodError` on mismatch. */
export function parseClaudeWorkflowJournalRecord(payload: unknown): ClaudeWorkflowJournalRecord {
  return claudeWorkflowJournalRecordSchema.parse(payload);
}

/** Like {@link parseClaudeWorkflowJournalRecord} but returns a result instead of throwing. */
export function safeParseClaudeWorkflowJournalRecord(payload: unknown) {
  return claudeWorkflowJournalRecordSchema.safeParse(payload);
}
