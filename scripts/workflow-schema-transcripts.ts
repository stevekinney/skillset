import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { claudeWorkflowRunRecordSchema } from '../src/claude-workflow-run-record.js';
import {
  claudeWorkflowToolInputSchema,
  claudeWorkflowToolOutputSchema,
} from '../src/claude-workflow-tool.js';
import { report, scriptFindings } from './workflow-schema-scripts.js';
import {
  count,
  display,
  failures,
  isObject,
  note,
  schemaFindings,
} from './workflow-schema-tally.js';

/** Run records. Returns the file names of the scripts the runs executed. */
export async function checkRecords(files: string[]): Promise<Set<string>> {
  const executed = new Set<string>();
  for (const file of files) {
    const location = `${display(file)}:1`;
    try {
      const record: unknown = JSON.parse(await readFile(file, 'utf8'));
      for (const issue of schemaFindings(
        'run record (wf_*.json)',
        claudeWorkflowRunRecordSchema,
        record,
      ))
        note(failures, issue.category, location);
      const scriptPath = isObject(record) ? record['scriptPath'] : undefined;
      // Keyed by full path: same-named scripts in two sessions are different files.
      if (typeof scriptPath === 'string') executed.add(resolve(scriptPath));
    } catch {
      note(failures, 'run record: invalid JSON', location);
    }
  }
  return executed;
}

/** Stream a file's lines, splitting on `\n` only (`readline` also splits on U+2028). */
async function* readLines(path: string): AsyncGenerator<string> {
  let carry = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    const parts = (carry + String(chunk)).split('\n');
    carry = parts.pop() ?? '';
    yield* parts;
  }
  if (carry !== '') yield carry;
}

/** An inline script awaiting its tool result: where it was, and whether this package rejects it. */
type Pending = { location: string; rejected: boolean };

/** The runtime's two refusals: a script that is not valid, and one that is not deterministic. */
function runtimeRejected(text: string): boolean {
  return text.includes('Invalid workflow script') || text.includes('must be deterministic');
}

function contentBlocks(record: Record<string, unknown>): unknown[] {
  const message = record['message'];
  return isObject(message) && Array.isArray(message['content']) ? message['content'] : [];
}

/** Compare an inline script with the verdict in the tool result that answers it. */
function checkVerdict(record: Record<string, unknown>, pending: Map<string, Pending>) {
  for (const block of contentBlocks(record)) {
    if (!isObject(block) || block['type'] !== 'tool_result') continue;
    const id = String(block['tool_use_id']);
    const entry = pending.get(id);
    if (!entry) continue;
    pending.delete(id);
    const refused = block['is_error'] === true && runtimeRejected(JSON.stringify(block['content']));
    if (refused === entry.rejected)
      count(refused ? 'inline scripts both reject' : 'inline scripts both accept');
    else
      note(
        failures,
        `inline script: ${entry.rejected ? 'rejected here, accepted by the runtime' : 'accepted here, rejected by the runtime'}`,
        entry.location,
      );
  }
}

function checkToolUse(
  block: Record<string, unknown>,
  location: string,
  pending: Map<string, Pending>,
) {
  const input = block['input'];
  for (const issue of schemaFindings(
    'Workflow tool input (transcript)',
    claudeWorkflowToolInputSchema,
    input,
  ))
    note(failures, issue.category, location);
  if (!isObject(input) || typeof input['script'] !== 'string') return;
  count('inline scripts (transcript)');
  const found = scriptFindings(input['script']);
  // Claude Code refuses a script at launch for its `meta`, syntax, and determinism only; the
  // other findings (an `agent()` option, say) would surface later, so they do not predict a refusal.
  const launch = found.failures.filter((finding) => finding.launchCheck);
  report(
    'inline script',
    { ...found, failures: found.failures.filter((finding) => !finding.launchCheck) },
    () => location,
  );
  pending.set(String(block['id']), { location, rejected: launch.length > 0 });
}

function checkToolOutput(record: Record<string, unknown>, location: string) {
  const result = record['toolUseResult'];
  if (!isObject(result)) return;
  for (const issue of schemaFindings(
    'Workflow tool output (transcript)',
    claudeWorkflowToolOutputSchema,
    result,
  ))
    note(failures, issue.category, location);
}

function checkTranscriptRecord(
  record: Record<string, unknown>,
  location: string,
  pending: Map<string, Pending>,
  workflowCalls: Set<string>,
) {
  for (const block of contentBlocks(record)) {
    if (isObject(block) && block['type'] === 'tool_use' && block['name'] === 'Workflow') {
      workflowCalls.add(String(block['id']));
      checkToolUse(block, location, pending);
    }
  }
  // A result is a Workflow output when it answers a Workflow call. Matching on
  // the call, not the result's fields, validates a malformed result (no taskId,
  // say) instead of skipping it, and leaves out the Agent tool's background
  // launches, which also report status "async_launched".
  for (const block of contentBlocks(record)) {
    if (!isObject(block) || block['type'] !== 'tool_result') continue;
    const id = String(block['tool_use_id']);
    if (!workflowCalls.delete(id)) continue;
    checkToolOutput(record, location);
  }
  checkVerdict(record, pending);
}

/** Whether a line can hold a Workflow call, or the result of one still awaiting its verdict. */
function isRelevant(
  line: string,
  pending: Map<string, Pending>,
  workflowCalls: Set<string>,
): boolean {
  // Both launch statuses are Workflow tool outputs: a local run and a remote one.
  if (
    line.includes('"name":"Workflow"') ||
    line.includes('"status":"async_launched"') ||
    line.includes('"status":"remote_launched"')
  ) {
    return true;
  }
  return (pending.size > 0 || workflowCalls.size > 0) && line.includes('"tool_result"');
}

export async function checkTranscripts(files: string[]) {
  for (const file of files) {
    const pending = new Map<string, Pending>();
    const workflowCalls = new Set<string>();
    let lineNumber = 0;
    for await (const line of readLines(file)) {
      lineNumber += 1;
      if (!isRelevant(line, pending, workflowCalls)) continue;
      try {
        const record: unknown = JSON.parse(line);
        if (isObject(record))
          checkTranscriptRecord(record, `${display(file)}:${lineNumber}`, pending, workflowCalls);
      } catch {
        count('transcript lines that were not JSON');
      }
    }
  }
}
