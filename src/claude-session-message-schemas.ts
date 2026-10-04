import { z } from 'zod';

import {
  claudeSessionAssistantContentBlockSchema,
  claudeSessionUserContentBlockSchema,
} from './claude-session-content-blocks.js';
import { claudeSessionStopReasons, looseRecord } from './claude-session-shared.js';

/**
 * The `message` envelope on `assistant` and `user` records: a Messages API
 * message as Claude Code persists it, with token usage on the assistant side.
 */

const cacheCreation = z.looseObject({
  ephemeral_1h_input_tokens: z.number(),
  ephemeral_5m_input_tokens: z.number(),
});

/** Token counts every sampling iteration reports. */
const iterationTokens = {
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
  cache_creation: cacheCreation.optional(),
};

/** One sampling iteration of a request: the main call, an advisor call, or a fallback model's call. */
const usageIteration = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('message'),
    ...iterationTokens,
    model: z.string().nullable().optional(),
  }),
  z.looseObject({ type: z.literal('advisor_message'), ...iterationTokens, model: z.string() }),
  z.looseObject({ type: z.literal('fallback_message'), ...iterationTokens, model: z.string() }),
]);

/** Token usage the API reports for one assistant message. */
export const claudeSessionUsageSchema = z.looseObject({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().nullable(),
  cache_read_input_tokens: z.number().nullable(),
  cache_creation: cacheCreation.nullable().optional(),
  server_tool_use: z
    .looseObject({ web_search_requests: z.number(), web_fetch_requests: z.number() })
    .nullable()
    .optional(),
  service_tier: z.enum(['standard', 'priority', 'batch']).nullable().optional(),
  // `not_available` on this machine; the API names regions here, so the set is open.
  inference_geo: z.string().nullable().optional(),
  speed: z.enum(['standard', 'fast']).nullable().optional(),
  iterations: z.array(usageIteration).nullable().optional(),
  output_tokens_details: z
    .looseObject({ thinking_tokens: z.number().optional() })
    .nullable()
    .optional(),
  // The outcome of a fallback-credit token the request presented; always `null` in real sessions.
  fallback_credit: looseRecord.nullable().optional(),
});
export type ClaudeSessionUsage = z.infer<typeof claudeSessionUsageSchema>;

/** Why the API could not reuse its prompt cache for a request. */
const cacheMissReason = z.looseObject({
  type: z.enum([
    'messages_changed',
    'previous_message_not_found',
    'unavailable',
    'system_changed',
    'model_changed',
    'tools_changed',
  ]),
  cache_missed_input_tokens: z.number().optional(),
});

/** A transformation Claude Code applied to the request before sending it. */
const inputTransformation = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('thinking_dropped'),
    path: z.string(),
    reason: z.enum(['model_binding_mismatch', 'prefix_binding_mismatch']),
  }),
]);

/** `message` on an `assistant` record. */
export const claudeSessionAssistantMessageSchema = z.looseObject({
  id: z.string().optional(),
  type: z.literal('message').optional(),
  role: z.literal('assistant'),
  model: z.string(),
  content: z.array(claudeSessionAssistantContentBlockSchema),
  stop_reason: z.enum(claudeSessionStopReasons).nullable(),
  // Empty string on synthetic stops; the matched stop sequence otherwise.
  stop_sequence: z.string().nullable().optional(),
  // Structured refusal details; `null` unless `stop_reason` is `refusal`.
  stop_details: looseRecord.nullable().optional(),
  usage: claudeSessionUsageSchema,
  // The code-execution container the request used, when any.
  container: looseRecord.nullable().optional(),
  context_management: z
    .looseObject({ applied_edits: z.array(looseRecord) })
    .nullable()
    .optional(),
  diagnostics: z.looseObject({ cache_miss_reason: cacheMissReason }).nullable().optional(),
  input_transformations: z.array(inputTransformation).optional(),
});
export type ClaudeSessionAssistantMessage = z.infer<typeof claudeSessionAssistantMessageSchema>;

/** `message` on a `user` record: a bare string, or a list of content blocks. */
export const claudeSessionUserMessageSchema = z.looseObject({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(claudeSessionUserContentBlockSchema)]),
});
export type ClaudeSessionUserMessage = z.infer<typeof claudeSessionUserMessageSchema>;
