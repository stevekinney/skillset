import { z } from 'zod';

import { claudeSessionAttachmentRecordSchema } from './claude-session-attachment-schemas.js';
import {
  claudeSessionAssistantRecordSchema,
  claudeSessionUserRecordSchema,
} from './claude-session-conversation-schemas.js';
import { looseRecord, sessionRecord } from './claude-session-shared.js';
import { claudeSessionStateRecordSchemas } from './claude-session-state-schemas.js';
import { claudeSessionSystemRecordSchema } from './claude-session-system-schemas.js';

/**
 * Zod schemas for the records in a Claude Code session transcript
 * (`~/.claude/projects/<project>/<session-id>.jsonl` and the subagent
 * transcripts beside it), checked against sessions written by Claude Code 2.1.221 through 2.1.289
 * and the 2.1.288 binary's own record-writing code.
 *
 * Every record is a `z.looseObject`, so a field a newer version adds never
 * fails a parse and survives into the parsed value.
 *
 * Not records: `journal.jsonl` files (workflow bookkeeping, see
 * `claude-session-workflow-journal.ts`) and `~/.claude/history.jsonl`
 * (the prompt-history list).
 *
 * Deliberately loose, and why:
 * - `tool_use.input`, `server_tool_use.input`: the named tool's own input schema.
 * - `toolUseResult` for MCP tools and the task, team and messaging tools: owned by
 *   third parties or unstable (see `claude-session-tool-result-schemas.ts`).
 * - `user.mcpMeta`: the MCP result's `_meta` and `structuredContent`, defined by each server.
 * - `user.serverClassifierContext.context`: the auto-mode classifier's internal input.
 * - `deferred_tools_record.entries[].input_schema`, `prompt_snapshot.tools[].schema`:
 *   JSON Schemas of the tools, which are the tools' own.
 * - `structured_output.data`: whatever schema the caller asked the agent to fill.
 * - `assistant.message` `stop_details`, `container`, `context_management.applied_edits`:
 *   API objects that are always `null` or empty in real sessions.
 * - `progress.data`, `content-replacement.replacements` and the `api-request*`
 *   bodies: binary-only records with no local sample.
 */

/** `progress` records: tool and hook heartbeats. Older versions wrote them to the transcript. */
const progressRecord = sessionRecord('progress', {
  // Several `data.type` variants (`hook_progress`, `tool_heartbeat`, ...) and no local sample.
  data: looseRecord,
  toolUseID: z.string().optional(),
  parentToolUseID: z.string().optional(),
  uuid: z.string().optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
});

/** One schema per `type`, keyed by it. */
export const claudeSessionRecordSchemas = {
  user: claudeSessionUserRecordSchema,
  assistant: claudeSessionAssistantRecordSchema,
  // Itself discriminated on `subtype`.
  system: claudeSessionSystemRecordSchema,
  attachment: claudeSessionAttachmentRecordSchema,
  progress: progressRecord,
  ...claudeSessionStateRecordSchemas,
};

export type ClaudeSessionRecordType = keyof typeof claudeSessionRecordSchemas;

/**
 * Every record `type` a session transcript can hold. A test checks that this
 * is exactly the keys of {@link claudeSessionRecordSchemas}.
 */
export const claudeSessionRecordTypeNames = [
  'user',
  'assistant',
  'system',
  'attachment',
  'progress',
  'agent-name',
  'agent-setting',
  'ai-title',
  'custom-title',
  'last-prompt',
  'mode',
  'permission-mode',
  'pr-link',
  'relocated',
  'worktree-state',
  'atis-latch',
  'bridge-session',
  'cost-state',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'tag',
  'agent-color',
  'summary',
  'continued-in',
  'ended-by-model',
  'isolation-latch',
  'dev-mods',
  'memory-mode',
  'history-suppression',
  'frame-link',
  'attribution-snapshot',
  'observer-ref',
  'fork-context-ref',
  'content-replacement',
  'api-request-shape',
  'api-request-blob',
  'api-request',
  'artifact-comment-monitor',
  'artifact-autoreact-ledger',
] as const satisfies readonly ClaudeSessionRecordType[];

/** Every record except `system`, discriminated on `type`. */
const nonSystemRecordSchema = z.discriminatedUnion('type', [
  claudeSessionRecordSchemas.user,
  claudeSessionRecordSchemas.assistant,
  claudeSessionRecordSchemas.attachment,
  claudeSessionRecordSchemas.progress,
  claudeSessionRecordSchemas['agent-name'],
  claudeSessionRecordSchemas['agent-setting'],
  claudeSessionRecordSchemas['ai-title'],
  claudeSessionRecordSchemas['custom-title'],
  claudeSessionRecordSchemas['last-prompt'],
  claudeSessionRecordSchemas.mode,
  claudeSessionRecordSchemas['permission-mode'],
  claudeSessionRecordSchemas['pr-link'],
  claudeSessionRecordSchemas.relocated,
  claudeSessionRecordSchemas['worktree-state'],
  claudeSessionRecordSchemas['atis-latch'],
  claudeSessionRecordSchemas['bridge-session'],
  claudeSessionRecordSchemas['cost-state'],
  claudeSessionRecordSchemas['queue-operation'],
  claudeSessionRecordSchemas['file-history-snapshot'],
  claudeSessionRecordSchemas['file-history-delta'],
  claudeSessionRecordSchemas.tag,
  claudeSessionRecordSchemas['agent-color'],
  claudeSessionRecordSchemas.summary,
  claudeSessionRecordSchemas['continued-in'],
  claudeSessionRecordSchemas['ended-by-model'],
  claudeSessionRecordSchemas['isolation-latch'],
  claudeSessionRecordSchemas['dev-mods'],
  claudeSessionRecordSchemas['memory-mode'],
  claudeSessionRecordSchemas['history-suppression'],
  claudeSessionRecordSchemas['frame-link'],
  claudeSessionRecordSchemas['attribution-snapshot'],
  claudeSessionRecordSchemas['observer-ref'],
  claudeSessionRecordSchemas['fork-context-ref'],
  claudeSessionRecordSchemas['content-replacement'],
  claudeSessionRecordSchemas['api-request-shape'],
  claudeSessionRecordSchemas['api-request-blob'],
  claudeSessionRecordSchemas['api-request'],
  claudeSessionRecordSchemas['artifact-comment-monitor'],
  claudeSessionRecordSchemas['artifact-autoreact-ledger'],
]);

/**
 * Any session transcript record. Dispatches on `type`; `system` records
 * dispatch again on `subtype`. Zod's `discriminatedUnion` cannot nest a union
 * discriminated on a different key, so the two levels are joined by a plain
 * union. Use {@link safeParseClaudeSessionRecord} for precise issue paths.
 */
export const claudeSessionRecordSchema = z.union([
  nonSystemRecordSchema,
  claudeSessionRecordSchemas.system,
]);

export type ClaudeSessionRecord = z.infer<typeof claudeSessionRecordSchema>;
/** One record type, for example `ClaudeSessionRecordFor<'assistant'>`. */
export type ClaudeSessionRecordFor<Type extends ClaudeSessionRecordType> = z.infer<
  (typeof claudeSessionRecordSchemas)[Type]
>;

/** Parse one record, dispatching on `type`. Throws a `ZodError` on mismatch. */
export function parseClaudeSessionRecord(payload: unknown): ClaudeSessionRecord {
  const result = safeParseClaudeSessionRecord(payload);
  if (!result.success) throw result.error;
  return result.data;
}

/**
 * Like {@link parseClaudeSessionRecord} but returns a result instead of
 * throwing. A record with a known `type` is checked against that type's own
 * schema, so its issues carry exact paths; anything else gets the union's
 * verdict.
 */
export function safeParseClaudeSessionRecord(payload: unknown) {
  const type = recordTypeOf(payload);
  const schema: z.ZodType<ClaudeSessionRecord> =
    type === undefined ? claudeSessionRecordSchema : claudeSessionRecordSchemas[type];
  return schema.safeParse(payload);
}

function isRecordType(value: unknown): value is ClaudeSessionRecordType {
  return typeof value === 'string' && Object.hasOwn(claudeSessionRecordSchemas, value);
}

/** The record type a payload claims, when it is one this schema knows. */
function recordTypeOf(payload: unknown): ClaudeSessionRecordType | undefined {
  if (typeof payload !== 'object' || payload === null || !('type' in payload)) return undefined;
  return isRecordType(payload.type) ? payload.type : undefined;
}
