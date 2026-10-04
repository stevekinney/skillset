import { z } from 'zod';

import { harnessMetadataSchema, messagePhaseSchema } from './codex-session-content.js';
import { buildResponseItemSchema, responseItemSchema } from './codex-session-response-items.js';
import { cyberAccessProgramSchema, multiAgentVersionSchema } from './codex-session-shared.js';
import { tokenUsageRecordPayloadSchema } from './codex-session-state.js';

/**
 * The `compacted` record payload: a summary of earlier turns plus the history
 * Codex keeps after a compaction.
 *
 * Sources: `CompactedItem`, `CompactionResumeMetadata`, `RetainedContext` and
 * `GuardianHistoryCheckpoint` in `codex-rs/history/src` at `rust-v0.160.0`.
 * `mcp_resource_origins` is from the Rust source only, unverified by data.
 *
 * Left loose on purpose:
 * - `mcp_resource_origins`: no real file contains one.
 * - `retained_context.verified_answers[]` and `.sender_deliveries[]`: always
 *   empty in real files, so their element shape is unknown.
 */

/** A `guardian_history` entry is a response item with Guardian's own metadata beside it. */
const guardianHistoryItemSchema = buildResponseItemSchema({
  guardian_metadata: harnessMetadataSchema.optional(),
});

const retainedMessageSchema = z.looseObject({
  turn_id: z.string(),
  message_id: z.string().nullable(),
  text: z.string(),
  complete: z.boolean(),
  order: z.number(),
  origin: z.enum(['user', 'heartbeat']).optional(),
  phase: messagePhaseSchema.optional(),
  revision: z.string().optional(),
});

const retainedContextSchema = z.looseObject({
  verified_answers: z.array(z.unknown()),
  incomplete: z.boolean(),
  user_messages: z.array(retainedMessageSchema).optional(),
  user_messages_incomplete: z.boolean().optional(),
  assistant_messages: z.array(retainedMessageSchema).optional(),
  assistant_messages_incomplete: z.boolean().optional(),
  next_order: z.number().optional(),
  sender_deliveries: z.array(z.unknown()).optional(),
});

export const compactedPayloadSchema = z.looseObject({
  message: z.string(),
  replacement_history: z.array(responseItemSchema).nullable().optional(),
  replacement_history_metadata: z.array(harnessMetadataSchema).optional(),
  guardian_history: z.array(guardianHistoryItemSchema).nullable().optional(),
  retained_context: retainedContextSchema.optional(),
  mcp_resource_origins: z.record(z.string(), z.unknown()).optional(),
  window_number: z.number().optional(),
  first_window_id: z.string().optional(),
  previous_window_id: z.string().optional(),
  window_id: z.string().optional(),
  compaction_response_id: z.string().nullable().optional(),
  latest_token_usage_record: tokenUsageRecordPayloadSchema.nullable().optional(),
  resume_metadata: z
    .looseObject({
      multi_agent_version: multiAgentVersionSchema.nullable(),
      last_started_turn_id: z.string().nullable(),
      previous_turn_settings: z
        .looseObject({
          model: z.string(),
          cyber_access_program: cyberAccessProgramSchema.optional(),
          comp_hash: z.string().nullable(),
          realtime_active: z.boolean().nullable(),
        })
        .nullable(),
    })
    .optional(),
});
