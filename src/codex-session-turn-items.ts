import { z } from 'zod';

import { messagePhaseSchema, toolOutputSchema } from './codex-session-content.js';
import { durationSchema, reasoningEffortSchema } from './codex-session-shared.js';
import {
  agentStatusSchema,
  extensionItemSchema,
  fileChangeSchema,
  parsedCommandSchema,
  reviewOutputSchema,
  reviewTargetSchema,
  searchResultSchema,
  status,
  userInputSchema,
} from './codex-session-turn-item-parts.js';

/**
 * `TurnItem`: the typed items a paginated rollout stores inside an
 * `item_completed` event, discriminated on the PascalCase `type`. Field casing
 * follows each Rust struct, so it is mixed: `snake_case` for most, `camelCase`
 * for `McpToolCall`, `HookPrompt` fragments, memory citations and extension
 * items.
 *
 * Sources: `codex-rs/protocol/src/items.rs`, `codex-rs/ext/items/src/*.rs` and
 * the structs they reference, at `rust-v0.160.0`. `ImageGeneration` is from the
 * Rust source only, unverified by data (image generation now arrives as an
 * `Extension`).
 *
 * Left loose on purpose:
 * - `FileChange.changes`: keyed by file path, so the keys are data.
 * - `CollabAgentToolCall.agents_states`: keyed by thread id.
 * - `McpToolCall.arguments`, `result.structuredContent`, `result._meta` and
 *   `result.content[]`: whatever the MCP server sent, so the shape is the
 *   server's.
 * - `DynamicToolCall.arguments` and `WebSearch` `results[]`: `serde_json::Value`
 *   in Rust.
 */

/** `item_completed.payload.item`, discriminated on `type`. */
export const turnItemSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('UserMessage'),
    id: z.string(),
    client_id: z.string().optional(),
    content: z.array(userInputSchema),
  }),
  z.looseObject({
    type: z.literal('FunctionCallOutput'),
    id: z.string(),
    name: z.string(),
    namespace: z.string().optional(),
    output: toolOutputSchema,
  }),
  z.looseObject({
    type: z.literal('HookPrompt'),
    id: z.string(),
    fragments: z.array(z.looseObject({ text: z.string(), hookRunId: z.string() })),
  }),
  z.looseObject({
    type: z.literal('AgentMessage'),
    id: z.string(),
    content: z.array(z.looseObject({ type: z.literal('Text'), text: z.string() })),
    phase: messagePhaseSchema.optional(),
    memory_citation: z
      .looseObject({
        entries: z.array(
          z.looseObject({
            path: z.string(),
            lineStart: z.number(),
            lineEnd: z.number(),
            note: z.string(),
          }),
        ),
        rolloutIds: z.array(z.string()),
      })
      .optional(),
    delivery: z.enum(['async']).optional(),
    questions: z
      .array(z.looseObject({ title: z.string(), options: z.array(z.string()).nullable() }))
      .optional(),
  }),
  z.looseObject({ type: z.literal('Plan'), id: z.string(), text: z.string() }),
  z.looseObject({
    type: z.literal('Reasoning'),
    id: z.string(),
    summary_text: z.array(z.string()),
    raw_content: z.array(z.string()).optional(),
  }),
  z.looseObject({
    type: z.literal('CommandExecution'),
    id: z.string(),
    plugin_id: z.string().optional(),
    script_path: z.string().optional(),
    process_id: z.string().optional(),
    command: z.array(z.string()),
    cwd: z.string(),
    parsed_cmd: z.array(parsedCommandSchema),
    source: z.enum(['agent', 'user_shell', 'unified_exec_startup', 'unified_exec_interaction']),
    interaction_input: z.string().optional(),
    status: z.enum(['in_progress', 'completed', 'failed', 'declined']),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    aggregated_output: z.string().optional(),
    exit_code: z.number().optional(),
    duration: durationSchema.optional(),
    formatted_output: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal('DynamicToolCall'),
    id: z.string(),
    namespace: z.string().optional(),
    tool: z.string(),
    arguments: z.unknown(),
    status: status.inProgress,
    content_items: z
      .array(
        z.discriminatedUnion('type', [
          z.looseObject({ type: z.literal('inputText'), text: z.string() }),
          z.looseObject({ type: z.literal('inputImage'), imageUrl: z.string() }),
          z.looseObject({ type: z.literal('inputAudio'), audioUrl: z.string() }),
        ]),
      )
      .optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
    duration: durationSchema.optional(),
  }),
  z.looseObject({
    type: z.literal('CollabAgentToolCall'),
    id: z.string(),
    tool: z.enum([
      'spawn_agent',
      'send_input',
      'resume_agent',
      'wait',
      'close_agent',
      'send_message',
      'followup_task',
      'interrupt_agent',
      'list_agents',
    ]),
    status: status.collab,
    sender_thread_id: z.string(),
    receiver_thread_ids: z.array(z.string()).optional(),
    receiver_agents: z
      .array(
        z.looseObject({
          thread_id: z.string(),
          agent_nickname: z.string().optional(),
          agent_role: z.string().optional(),
        }),
      )
      .optional(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    reasoning_effort: reasoningEffortSchema.optional(),
    agents_states: z.record(z.string(), agentStatusSchema).optional(),
  }),
  z.looseObject({
    type: z.literal('SubAgentActivity'),
    id: z.string(),
    kind: z.enum(['started', 'interacted', 'interrupted', 'completed']),
    agent_thread_id: z.string(),
    agent_path: z.string(),
  }),
  z.looseObject({
    type: z.literal('WebSearch'),
    id: z.string(),
    query: z.string(),
    action: z.discriminatedUnion('type', [
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
    ]),
    results: z.array(searchResultSchema).optional(),
  }),
  z.looseObject({ type: z.literal('ImageView'), id: z.string(), path: z.string() }),
  extensionItemSchema,
  z.looseObject({
    type: z.literal('ImageGeneration'),
    id: z.string(),
    status: z.string(),
    revised_prompt: z.string().optional(),
    result: z.string(),
    saved_path: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal('EnteredReviewMode'),
    id: z.string(),
    target: reviewTargetSchema,
    user_facing_hint: z.string(),
  }),
  z.looseObject({
    type: z.literal('ExitedReviewMode'),
    id: z.string(),
    review_output: reviewOutputSchema.nullable(),
  }),
  z.looseObject({
    type: z.literal('FileChange'),
    id: z.string(),
    changes: z.record(z.string(), fileChangeSchema),
    status: z.enum(['completed', 'failed', 'declined']).optional(),
    auto_approved: z.boolean().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal('McpToolCall'),
    id: z.string(),
    server: z.string(),
    tool: z.string(),
    arguments: z.unknown(),
    connectorId: z.string().optional(),
    mcpAppResourceUri: z.string().optional(),
    mcpAppUi: z.record(z.string(), z.unknown()).optional(),
    linkId: z.string().optional(),
    appName: z.string().optional(),
    actionName: z.string().optional(),
    pluginId: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    status: status.inProgress,
    result: z
      .looseObject({
        content: z.array(z.unknown()),
        structuredContent: z.unknown().optional(),
        isError: z.boolean().optional(),
        _meta: z.unknown().optional(),
      })
      .optional(),
    error: z.looseObject({ message: z.string() }).optional(),
    duration: durationSchema.optional(),
  }),
  z.looseObject({ type: z.literal('ContextCompaction'), id: z.string() }),
]);

export type TurnItem = z.infer<typeof turnItemSchema>;
