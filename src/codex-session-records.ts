import { z } from 'zod';

import { codexCompactedPayloadSchema } from './codex-session-compaction.js';
import { harnessMetadataSchema } from './codex-session-content.js';
import { codexEventMessageSchema } from './codex-session-events.js';
import {
  codexSessionMetaPayloadSchema,
  codexTurnContextPayloadSchema,
} from './codex-session-metadata.js';
import { codexResponseItemSchema } from './codex-session-response-items.js';
import {
  interAgentCommunicationMetadataPayloadSchema,
  interAgentCommunicationPayloadSchema,
  openRecordPayloadSchema,
  securityRiskScorePayloadSchema,
  tokenUsageRecordPayloadSchema,
  worldStatePayloadSchema,
} from './codex-session-state.js';

/**
 * Zod schemas for one line of a Codex session rollout: the JSONL files Codex
 * writes under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and moves to
 * `~/.codex/archived_sessions/`.
 *
 * A line is `{ timestamp, ordinal?, type, payload }`, discriminated on `type`
 * (Rust's `RolloutLine` and `RolloutItem`). The payload schemas live in the
 * sibling `codex-session-*` modules and are discriminated again on
 * `payload.type` where the payload is a union (`response_item`, `event_msg`).
 * Every object is a `z.looseObject`, so a field a newer Codex adds never fails
 * a parse; each module comment lists what was left loose on purpose and why.
 *
 * Sources: `codex-rs/history/src/{lib,rollout_payload}.rs` and
 * `codex-rs/protocol/src` at `rust-v0.160.0`, verified against 10,102 real
 * rollout files with `scripts/check-codex-session-schema.ts`.
 */

/** Every `type` a rollout line can carry. */
export const codexSessionRecordTypes = [
  'session_meta',
  'response_item',
  'inter_agent_communication',
  'inter_agent_communication_metadata',
  'compacted',
  'turn_context',
  'token_usage_record',
  'world_state',
  'retained_context',
  'security_risk_score',
  'event_msg',
  'realtime_item',
] as const;

export type CodexSessionRecordType = (typeof codexSessionRecordTypes)[number];

/** Every `payload.type` a `response_item` record can carry. */
export const codexResponseItemTypes = [
  'message',
  'agent_message',
  'reasoning',
  'local_shell_call',
  'function_call',
  'tool_search_call',
  'function_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'tool_search_output',
  'web_search_call',
  'image_generation_call',
  'compaction',
  'compaction_summary',
  'configuration_update',
  'context_compaction',
  'other',
] as const;

export { codexEventMessageTypes } from './codex-session-events.js';

const envelope = { timestamp: z.string(), ordinal: z.number().optional() };

function record<Type extends CodexSessionRecordType, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z.looseObject({ ...envelope, type: z.literal(type), payload });
}

/** The schema for each record `type`, for example `codexSessionRecordSchemas.event_msg`. */
export const codexSessionRecordSchemas = {
  session_meta: record('session_meta', codexSessionMetaPayloadSchema),
  response_item: z.looseObject({
    ...envelope,
    type: z.literal('response_item'),
    payload: codexResponseItemSchema,
    metadata: harnessMetadataSchema.optional(),
  }),
  inter_agent_communication: record(
    'inter_agent_communication',
    interAgentCommunicationPayloadSchema,
  ),
  inter_agent_communication_metadata: record(
    'inter_agent_communication_metadata',
    interAgentCommunicationMetadataPayloadSchema,
  ),
  compacted: record('compacted', codexCompactedPayloadSchema),
  turn_context: record('turn_context', codexTurnContextPayloadSchema),
  token_usage_record: record('token_usage_record', tokenUsageRecordPayloadSchema),
  world_state: record('world_state', worldStatePayloadSchema),
  retained_context: record('retained_context', openRecordPayloadSchema),
  security_risk_score: record('security_risk_score', securityRiskScorePayloadSchema),
  event_msg: record('event_msg', codexEventMessageSchema),
  realtime_item: record('realtime_item', openRecordPayloadSchema),
} as const;

const schemas = codexSessionRecordSchemas;

/** One rollout line, discriminated on `type`. */
export const codexSessionRecordSchema = z.discriminatedUnion('type', [
  schemas.session_meta,
  schemas.response_item,
  schemas.inter_agent_communication,
  schemas.inter_agent_communication_metadata,
  schemas.compacted,
  schemas.turn_context,
  schemas.token_usage_record,
  schemas.world_state,
  schemas.retained_context,
  schemas.security_risk_score,
  schemas.event_msg,
  schemas.realtime_item,
]);

export type CodexSessionRecord = z.infer<typeof codexSessionRecordSchema>;

/** The record for one `type`, for example `CodexSessionRecordFor<'event_msg'>`. */
export type CodexSessionRecordFor<Type extends CodexSessionRecordType> = Extract<
  CodexSessionRecord,
  { type: Type }
>;

/** The payload of one record `type`. */
export type CodexSessionPayloadFor<Type extends CodexSessionRecordType> =
  CodexSessionRecordFor<Type>['payload'];

export type CodexResponseItemType = (typeof codexResponseItemTypes)[number];

/** A `response_item` payload, for example `CodexResponseItemFor<'function_call'>`. */
export type CodexResponseItemFor<Type extends CodexResponseItemType> = Extract<
  CodexSessionPayloadFor<'response_item'>,
  { type: Type }
>;

/** An `event_msg` payload, for example `CodexEventMessageFor<'token_count'>`. */
export type CodexEventMessageFor<Type extends CodexSessionPayloadFor<'event_msg'>['type']> =
  Extract<CodexSessionPayloadFor<'event_msg'>, { type: Type }>;

/** Parse one rollout line (already `JSON.parse`d). Throws a `ZodError` on mismatch. */
export function parseCodexSessionRecord(value: unknown): CodexSessionRecord {
  return codexSessionRecordSchema.parse(value);
}

/** Like {@link parseCodexSessionRecord} but returns a result instead of throwing. */
export function safeParseCodexSessionRecord(value: unknown) {
  return codexSessionRecordSchema.safeParse(value);
}
