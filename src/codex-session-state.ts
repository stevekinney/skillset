import { z } from 'zod';

import { internalMessageMetadataSchema } from './codex-session-content.js';
import {
  modeKindSchema,
  multiAgentModeSchema,
  personalitySchema,
  tokenUsageSchema,
} from './codex-session-shared.js';

/**
 * The smaller record payloads: `token_usage_record`, `world_state`,
 * `inter_agent_communication(_metadata)`, `security_risk_score`,
 * `retained_context` and `realtime_item`.
 *
 * Sources: `RolloutItemWire` in `codex-rs/history/src/rollout_payload.rs`,
 * `WorldStateItem`, `TokenUsageRecord` and `InterAgentCommunication` in
 * `codex-rs/protocol/src/protocol.rs`, at `rust-v0.160.0`. Verified against
 * real data: `token_usage_record`, `world_state`,
 * `inter_agent_communication_metadata`. From the Rust source only, unverified
 * by data: `inter_agent_communication`, `security_risk_score`; and loose
 * because no real file contains one: `retained_context`, `realtime_item`.
 *
 * `world_state.state` is a `serde_json::Map` in Rust, so any key is legal. The
 * keys real files carry are named below and everything else is allowed.
 *
 * Left loose on purpose:
 * - `world_state.state.managed_developer_instructions` and `.persistent_mode`:
 *   always an empty object in real files, so their shape is unknown.
 * - `world_state.state.environments.environments`: keyed by environment id, so
 *   the keys are data (each value is modeled).
 * - `retained_context` and `realtime_item` payloads: see above.
 */

export const tokenUsageRecordPayloadSchema = z.looseObject({
  thread_id: z.string(),
  turn_id: z.string(),
  session_id: z.string(),
  root_turn_id: z.string(),
  response_id: z.string(),
  usage: tokenUsageSchema,
  turn_token_usage: tokenUsageSchema,
  thread_token_usage: tokenUsageSchema,
});

const includeInstructions = z.looseObject({ includeInstructions: z.boolean() });

const worldStateEnvironmentsSchema = z.looseObject({
  current_date: z.string().optional(),
  environments: z
    .record(z.string(), z.looseObject({ cwd: z.string(), shell: z.string(), status: z.string() }))
    .optional(),
  filesystem: z.string().optional(),
  subagents: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

export const worldStatePayloadSchema = z.looseObject({
  full: z.boolean(),
  state: z.looseObject({
    agents_md: z
      .looseObject({ directory: z.string().nullable().optional(), text: z.string().optional() })
      .optional(),
    apps_instructions: z.boolean().optional(),
    collaboration_mode: z
      .union([
        modeKindSchema,
        z.looseObject({
          instructions: z.string().optional(),
          mode: modeKindSchema.optional(),
          model: z.string().optional(),
        }),
      ])
      .nullable()
      .optional(),
    context_window_guidance: z.string().optional(),
    environments: worldStateEnvironmentsSchema.optional(),
    environments_instructions: z.boolean().optional(),
    git_attribution: z.boolean().optional(),
    host_skills: z
      .looseObject({ body: z.string().optional(), includeInstructions: z.boolean().optional() })
      .optional(),
    managed_developer_instructions: z.record(z.string(), z.unknown()).optional(),
    model: z.string().optional(),
    multi_agent_mode: z
      .looseObject({
        mode: multiAgentModeSchema.optional(),
        usage_hint_hash: z.string().optional(),
      })
      .optional(),
    multi_agent_usage_hint: z.string().optional(),
    orchestrator_skills: z
      .looseObject({ enabled: z.boolean(), includeInstructions: z.boolean() })
      .optional(),
    permissions: z
      .union([
        z.string(),
        z.looseObject({
          approved_command_prefixes: z.array(z.array(z.string())).optional(),
          instructions: z.string().optional(),
        }),
      ])
      .optional(),
    persistent_mode: z.record(z.string(), z.unknown()).optional(),
    personality: z
      .looseObject({ model: z.string().optional(), personality: personalitySchema.optional() })
      .nullable()
      .optional(),
    plugins_instructions: z.boolean().optional(),
    realtime: z.looseObject({ active: z.boolean() }).optional(),
    skills: includeInstructions.optional(),
  }),
});

export const interAgentCommunicationMetadataPayloadSchema = z.looseObject({
  trigger_turn: z.boolean(),
});

export const interAgentCommunicationPayloadSchema = z.looseObject({
  id: z.string().optional(),
  author: z.string(),
  recipient: z.string(),
  other_recipients: z.array(z.string()).optional(),
  content: z.string(),
  encrypted_content: z.string().optional(),
  internal_chat_message_metadata_passthrough: internalMessageMetadataSchema.optional(),
  trigger_turn: z.boolean(),
});

export const securityRiskScorePayloadSchema = z.looseObject({
  scores: z.record(z.string(), z.number()),
  call_id: z.string().optional(),
  action: z.unknown().optional(),
  sampled_at: z.string().optional(),
});

/** No real rollout contains a `retained_context` or `realtime_item` record, so the payload is left open. */
export const openRecordPayloadSchema = z.record(z.string(), z.unknown());
