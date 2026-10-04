import { z } from 'zod';

/**
 * Message content items and the per-item metadata that rides along with every
 * Responses API item in a Codex rollout: `internal_chat_message_metadata_
 * passthrough` (inside the payload) and the harness `metadata` (beside it).
 *
 * Sources: `codex-rs/protocol/src/{models,mcp}.rs` and
 * `codex-rs/history/src/{lib,retained_context}.rs` at `rust-v0.160.0`.
 *
 * Left loose on purpose:
 * - `executed_tool_calls[].arguments`: the arguments of whichever tool ran, so
 *   its shape is the tool's, not Codex's.
 */

/** The role of a message. `system` is the Responses API spelling Codex also accepts. */
export const messageRoleSchema = z.enum(['user', 'assistant', 'developer', 'system']);

export const messagePhaseSchema = z.enum(['commentary', 'final_answer']);

export const imageDetailSchema = z.enum(['auto', 'low', 'high', 'original']);

const textShape = { text: z.string() };

/** An image is either inline (`image_url`) or an uploaded file (`file_id`). */
const imageShape = {
  image_url: z.string().optional(),
  file_id: z.string().optional(),
  detail: imageDetailSchema.optional(),
};

const inputText = z.looseObject({ type: z.literal('input_text'), ...textShape });
const inputImage = z.looseObject({ type: z.literal('input_image'), ...imageShape });
const inputAudio = z.looseObject({ type: z.literal('input_audio'), audio_url: z.string() });
const encryptedContent = z.looseObject({
  type: z.literal('encrypted_content'),
  encrypted_content: z.string(),
});

/** `ContentItem`: what a `message` item holds. */
export const messageContentItemSchema = z.discriminatedUnion('type', [
  inputText,
  inputImage,
  inputAudio,
  z.looseObject({ type: z.literal('output_text'), ...textShape }),
]);

/** `FunctionCallOutputContentItem`: what a structured tool output holds. */
export const toolOutputContentItemSchema = z.discriminatedUnion('type', [
  inputText,
  inputImage,
  inputAudio,
  encryptedContent,
]);

/** `AgentMessageInputContent`. */
export const agentMessageContentItemSchema = z.discriminatedUnion('type', [
  inputText,
  encryptedContent,
]);

/** A tool output is plain text or a list of structured content items. */
export const toolOutputSchema = z.union([z.string(), z.array(toolOutputContentItemSchema)]);

const executedToolCallSchema = z.looseObject({
  name: z.string(),
  arguments: z.unknown(),
  tool_result_sources: z.unknown().optional(),
  tool_result_metadata: z.unknown().optional(),
});

/**
 * `InternalChatMessageMetadataPassthrough`. `content_item_kinds` is a list of
 * free-form kind labels (`ContentItemKind` is a newtype over `String`).
 */
export const internalMessageMetadataSchema = z.looseObject({
  turn_id: z.string().optional(),
  create_time: z.number().optional(),
  content_item_kinds: z.array(z.string()).optional(),
  cell_id: z.string().optional(),
  executed_tool_calls: z.array(executedToolCallSchema).optional(),
  tool_calls_complete: z.boolean().optional(),
});

export const mcpAttributionSchema = z.looseObject({
  status: z.enum(['none', 'complete', 'attribution_error']),
  error_reason: z
    .enum([
      'history_missing_checkpoint',
      'checkpoint_invalid',
      'checkpoint_source_conflict',
      'source_invalid',
      'recorder_poisoned',
      'restored_error_unknown',
      'payload_too_large',
      'serialization_failed',
      'unknown',
    ])
    .optional(),
  sources: z
    .array(
      z.looseObject({
        connector_id: z.string().optional(),
        plugin_id: z.string().optional(),
        server_name: z.string(),
        tool_name: z.string(),
        first_turn_id: z.string(),
      }),
    )
    .optional(),
});

export const retainedSourceSchema = z.looseObject({
  complete: z.boolean(),
  id: z.looseObject({
    message_id: z.string(),
    role: z.enum(['user', 'assistant']),
    turn_id: z.string(),
  }),
  revision: z.string(),
});

export const senderUserMessagesSchema = z.looseObject({
  receiver_turn_id: z.string(),
  receiver_message_id: z.string(),
  text: z.string(),
});

/**
 * `CodexHarnessMetadata`: facts the harness records about one item. It appears
 * as the record-level `metadata` of a `response_item`, as `guardian_metadata`
 * inside a compaction's `guardian_history`, and in `replacement_history_metadata`.
 */
export const harnessMetadataSchema = z.looseObject({
  guardian_sources: z.array(retainedSourceSchema).optional(),
  guardian_source_order_guidance: z.boolean().optional(),
  retained_source: retainedSourceSchema.optional(),
  client_authored: z.boolean().optional(),
  fallback_token_limit_override: z.number().optional(),
  delivered_assistant_message: z.string().optional(),
  harness_authored_configuration: z.boolean().optional(),
  compaction_model_hash: z.string().optional(),
  user_input_order: z.number().optional(),
  compaction_output: z.boolean().optional(),
  inherited_user_message: z.boolean().optional(),
  mcp_attribution: mcpAttributionSchema.optional(),
  sender_user_messages: senderUserMessagesSchema.optional(),
});
