import { createReadStream } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';

import type { z } from 'zod';

import { claudeSessionRecordSchemas } from '../src/claude-session-record-schema.js';
import { claudeWorkflowJournalRecordSchemas } from '../src/claude-session-workflow-journal.js';
import { addFailure, addLineFailure, type FailureGroup } from './claude-session-schema-failures.js';
import { expectedLoosePaths } from './claude-session-schema-expected.js';
import { printReport, type Report } from './claude-session-schema-report.js';
import { emptyStatistics, walkValue, type WalkContext } from './claude-session-schema-walker.js';
/**
 * Checks the Claude Code session-transcript schemas against every session
 * file on this machine: it streams each `.jsonl` under `~/.claude/projects`
 * one line at a time (never a whole file), parses every record with its
 * schema, and walks the parsed value beside the schema to find fields the
 * schema does not name.
 *
 * Output is limited to record types, field paths, counts, enum values and
 * file:line locations; it never prints record content.
 *
 * Exits non-zero when any record fails to parse, any key is unmodeled, or a
 * loose spot is not one of the documented ones.
 *
 * Usage: bun run scripts/check-claude-session-schema.ts [--root <directory>] [--all-strings]
 */

type SchemaMap = Record<string, z.ZodType>;
type JsonObject = Record<string, unknown>;

const transcriptSchemas: SchemaMap = claudeSessionRecordSchemas;
const journalSchemas: SchemaMap = claudeWorkflowJournalRecordSchemas;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `message.content` blocks of a record, or none. */
function contentBlocks(record: JsonObject): unknown[] {
  const message = record['message'];
  if (!isObject(message)) return [];
  const content = message['content'];
  return Array.isArray(content) ? content : [];
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function sessionFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith('.jsonl'))
    .map((entry) => join(root, entry))
    .toSorted();
}

/** The label a record is grouped under: its type, plus subtype or attachment type. */
function labelOf(record: JsonObject, prefix: string): string {
  const type = String(record['type']);
  const attachment = record['attachment'];
  if (type === 'system') return `${prefix}system{${String(record['subtype'])}}`;
  if (type === 'attachment' && isObject(attachment))
    return `${prefix}attachment{${String(attachment['type'])}}`;
  return `${prefix}${type}`;
}

/** Remember which tool each `tool_use` block named so a later result can be attributed. */
function trackToolNames(record: JsonObject, toolNames: Map<string, string>) {
  for (const block of contentBlocks(record)) {
    if (isObject(block) && block['type'] === 'tool_use')
      toolNames.set(String(block['id']), String(block['name']));
  }
}

function toolNameFor(record: JsonObject, toolNames: Map<string, string>) {
  const first = contentBlocks(record)[0];
  return isObject(first) && first['type'] === 'tool_result'
    ? toolNames.get(String(first['tool_use_id']))
    : undefined;
}

/** Tally of what the files hold, for the report's coverage section. */
function countSeen(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const report: Report = {
  files: 0,
  lines: 0,
  parsed: 0,
  invalidJson: new Map<string, FailureGroup>(),
  truncatedTails: new Map<string, FailureGroup>(),
  failures: new Map<string, FailureGroup>(),
  seen: new Map<string, number>(),
  statistics: emptyStatistics(),
  schemaLabels: [],
};

function checkRecord(
  schemas: SchemaMap,
  prefix: string,
  record: JsonObject,
  location: string,
  context: WalkContext,
) {
  const label = labelOf(record, prefix);
  const type = String(record['type']);
  const schema = Object.hasOwn(schemas, type) ? schemas[type] : undefined;
  countSeen(report.seen, label);
  if (!schema) {
    addFailure(report.failures, label, location, record, [
      { code: 'invalid_value', values: [], path: ['type'], message: 'unknown record type' },
    ]);
    return;
  }
  const result = schema.safeParse(record);
  if (!result.success) {
    addFailure(report.failures, label, location, record, result.error.issues);
    return;
  }
  report.parsed += 1;
  walkValue(schema, record, label.replace(/\{.*$/, ''), report.statistics, context);
}

async function checkFile(root: string, path: string) {
  const journal = basename(path) === 'journal.jsonl';
  const schemas = journal ? journalSchemas : transcriptSchemas;
  const prefix = journal ? 'journal:' : '';
  const toolNames = new Map<string, string>();
  // The most recent line that was not JSON. It is a failure unless it turns out to be the
  // file's unterminated last line, which is a write still in progress (or cut short).
  let pendingInvalid: string | undefined;
  let lineNumber = 0;
  for await (const line of readLines(path)) {
    lineNumber += 1;
    if (pendingInvalid !== undefined)
      addLineFailure(report.invalidJson, 'invalid JSON', pendingInvalid);
    pendingInvalid = undefined;
    if (line.trim() === '') continue;
    report.lines += 1;
    const location = `${relative(root, path)}:${lineNumber}`;
    const record = parseLine(line);
    if (record === 'invalid JSON') pendingInvalid = location;
    else if (record === 'not an object') addLineFailure(report.invalidJson, record, location);
    else {
      trackToolNames(record, toolNames);
      checkRecord(schemas, prefix, record, location, { toolName: toolNameFor(record, toolNames) });
    }
  }
  if (pendingInvalid === undefined) return;
  const target = (await endsWithNewline(path)) ? report.invalidJson : report.truncatedTails;
  addLineFailure(target, 'invalid JSON', pendingInvalid);
}

/**
 * Stream a file's lines, splitting on `\n` only. `node:readline` also splits on
 * U+2028 and U+2029, which `JSON.stringify` leaves raw inside strings, so it
 * cuts valid records in half.
 */
async function* readLines(path: string): AsyncGenerator<string> {
  let carry = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    const parts = (carry + String(chunk)).split('\n');
    carry = parts.pop() ?? '';
    yield* parts;
  }
  if (carry !== '') yield carry;
}

/** Whether the file's last byte is a newline; a transcript still being written ends mid-line. */
async function endsWithNewline(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

/** Parse one line into a record, or say why it is not one. */
function parseLine(line: string): JsonObject | 'invalid JSON' | 'not an object' {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return 'invalid JSON';
  }
  return isObject(value) ? value : 'not an object';
}

const root = optionValue('--root') ?? join(homedir(), '.claude', 'projects');
const files = await sessionFiles(root);
report.schemaLabels = Object.keys(transcriptSchemas);
for (const file of files) {
  report.files += 1;
  await checkFile(root, file);
}

const exitCode = printReport(report, {
  expectedLoose: expectedLoosePaths,
  allStrings: process.argv.includes('--all-strings'),
});
process.exit(exitCode);
