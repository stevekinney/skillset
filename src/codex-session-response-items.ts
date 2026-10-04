import { z } from 'zod';

import {
  agentMessageContentItemSchema,
  internalMessageMetadataSchema,
  messageContentItemSchema,
  messagePhaseSchema,
  messageRoleSchema,
  toolOutputSchema,
} from './codex-session-content.js';

/**
 * `ResponseItem`: the Responses API items a rollout's `response_item` records
 * carry as their payload, discriminated on `type`. Also reused for the items
 * inside a `compacted` record's `replacement_history` and `guardian_history`.
 *
 * Sources: `codex-rs/protocol/src/models.rs` and the persisted-item filter in
 * `codex-rs/rollout/src/policy.rs` at `rust-v0.160.0`. Not modeled because
 * Codex never persists them: `additional_tools` and `compaction_trigger`.
 *
 * Verified against real data: `message`, `agent_message`, `reasoning`,
 * `function_call`, `function_call_output`, `custom_tool_call`,
 * `custom_tool_call_output`, `tool_search_call`, `tool_search_output`,
 * `web_search_call`, `image_generation_call`, `compaction`, `other`. From the
 * Rust source only, unverified by data: `local_shell_call`,
 * `configuration_update`, `context_compaction`.
 *
 * Left loose on purpose:
 * - `tool_search_call.arguments`: a free-form object the model fills in.
 * - `tool_search_output.tools[]`: JSON-Schema tool definitions Codex only
 *   forwards, so a function's schema and a namespace's `tools[]` stay loose.
 * - `configuration_update.reasoning` and `local_shell_call.action.env`: shapes
 *   no real file exercises.
 */

/** Responses API item statuses. */
const itemStatusSchema = z.enum(['in_progress', 'completed', 'incomplete', 'failed']);

const toolSearchExecutionSchema = z.enum(['client', 'server']);

/** A tool a `tool_search_output` offers: a function, or a namespace holding functions. */
const toolSearchToolSchema = z.looseObject({
  type: z.enum(['function', 'namespace']),
  name: z.string(),
  description: z.string().optional(),
  tools: z.array(z.record(z.string(), z.unknown())).optional(),
});

const idShape = { id: z.string().optional() };

/** The Responses API `web_search_call` action (snake_case, unlike the extension item's). */
export const responsesWebSearchActionSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('search'),
    query: z.string().optional(),
    queries: z.array(z.string()).optional(),
  }),
  z.looseObject({ type: z.literal('open_page'), url: z.string().optional() }),
  z.looseObject({
    type: z.literal('find_in_page'),
    url: z.string().optional(),
    pattern: z.string().optional(),
  }),
  z.looseObject({ type: z.literal('other') }),
]);

/**
 * Builds the `ResponseItem` union. `extraShape` is added to every variant, which
 * is how `guardian_history` entries gain their `guardian_metadata` key.
 */
export function buildCodexResponseItemSchema<Extra extends z.ZodRawShape>(extraShape: Extra) {
  const base = {
    ...idShape,
    internal_chat_message_metadata_passthrough: internalMessageMetadataSchema.optional(),
    ...extraShape,
  };
  return z.discriminatedUnion('type', [
    z.looseObject({
      type: z.literal('message'),
      ...base,
      role: messageRoleSchema,
      content: z.array(messageContentItemSchema),
      phase: messagePhaseSchema.optional(),
    }),
    z.looseObject({
      type: z.literal('agent_message'),
      ...base,
      author: z.string(),
      recipient: z.string(),
      content: z.array(agentMessageContentItemSchema),
    }),
    z.looseObject({
      type: z.literal('reasoning'),
      ...base,
      summary: z.array(z.looseObject({ type: z.literal('summary_text'), text: z.string() })),
      content: z
        .array(z.looseObject({ type: z.enum(['reasoning_text', 'text']), text: z.string() }))
        .nullable()
        .optional(),
      encrypted_content: z.string().nullable(),
    }),
    z.looseObject({
      type: z.literal('local_shell_call'),
      ...base,
      call_id: z.string().nullable(),
      status: z.enum(['completed', 'in_progress', 'incomplete']),
      action: z.looseObject({
        type: z.literal('exec'),
        command: z.array(z.string()),
        timeout_ms: z.number().nullable().optional(),
        working_directory: z.string().nullable().optional(),
        env: z.record(z.string(), z.string()).nullable().optional(),
        user: z.string().nullable().optional(),
      }),
    }),
    z.looseObject({
      type: z.literal('function_call'),
      ...base,
      name: z.string(),
      namespace: z.string().optional(),
      arguments: z.string(),
      encrypted_function_args: z.array(z.string()).optional(),
      call_id: z.string(),
    }),
    z.looseObject({
      type: z.literal('tool_search_call'),
      ...base,
      call_id: z.string().nullable(),
      status: itemStatusSchema.optional(),
      execution: toolSearchExecutionSchema,
      arguments: z.record(z.string(), z.unknown()),
    }),
    z.looseObject({
      type: z.literal('function_call_output'),
      ...base,
      call_id: z.string().optional(),
      name: z.string().optional(),
      namespace: z.string().optional(),
      output: toolOutputSchema,
    }),
    z.looseObject({
      type: z.literal('custom_tool_call'),
      ...base,
      status: itemStatusSchema.optional(),
      call_id: z.string(),
      name: z.string(),
      namespace: z.string().optional(),
      input: z.string(),
    }),
    z.looseObject({
      type: z.literal('custom_tool_call_output'),
      ...base,
      call_id: z.string(),
      name: z.string().optional(),
      output: toolOutputSchema,
    }),
    z.looseObject({
      type: z.literal('tool_search_output'),
      ...base,
      call_id: z.string().nullable(),
      status: itemStatusSchema,
      execution: toolSearchExecutionSchema,
      tools: z.array(toolSearchToolSchema),
    }),
    z.looseObject({
      type: z.literal('web_search_call'),
      ...base,
      status: z.enum(['in_progress', 'searching', 'completed', 'failed']).optional(),
      action: responsesWebSearchActionSchema.optional(),
    }),
    z.looseObject({
      type: z.literal('image_generation_call'),
      ...base,
      status: z.enum(['in_progress', 'generating', 'completed', 'failed']),
      revised_prompt: z.string().optional(),
      result: z.string(),
    }),
    // Separate variants (not one `z.enum` type) so `CodexResponseItemFor` can
    // narrow to each: `Extract` does not distribute over a union-typed `type`.
    z.looseObject({
      type: z.literal('compaction'),
      ...base,
      encrypted_content: z.string(),
    }),
    z.looseObject({
      type: z.literal('compaction_summary'),
      ...base,
      encrypted_content: z.string(),
    }),
    z.looseObject({
      type: z.literal('configuration_update'),
      ...extraShape,
      reasoning: z.record(z.string(), z.unknown()),
    }),
    z.looseObject({
      type: z.literal('context_compaction'),
      ...base,
      encrypted_content: z.string().nullable().optional(),
    }),
    // Rust's `#[serde(other)]`: an item type this Codex version does not know.
    z.looseObject({ type: z.literal('other') }),
  ]);
}

export const codexResponseItemSchema = buildCodexResponseItemSchema({});

/** One Codex `response_item` payload; `CodexResponseItemFor` narrows to one type. */
export type CodexResponseItem = z.infer<typeof codexResponseItemSchema>;
