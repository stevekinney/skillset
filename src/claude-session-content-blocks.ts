import { z } from 'zod';

import { looseRecord } from './claude-session-shared.js';

/**
 * Content blocks inside a session transcript's `message.content`, in the
 * shape Claude Code persists them: the Messages API's response blocks on
 * `assistant` records and its request blocks on `user` records.
 *
 * Block types whose body this machine has never recorded (the server-tool
 * result blocks, MCP tool blocks, `container_upload`, `compaction`) are
 * accepted by their `type` tag alone, as the binary's own schema does.
 */

const cacheControl = z
  .looseObject({ type: z.literal('ephemeral'), ttl: z.enum(['5m', '1h']).optional() })
  .nullable()
  .optional();

/** A block that is known only by its `type` tag. */
function taggedBlock<Type extends string>(type: Type) {
  return z.looseObject({ type: z.literal(type) });
}

const textBlock = z.looseObject({
  type: z.literal('text'),
  text: z.string(),
  // Citation locations (char, page, content-block, web-search and search-result locations),
  // left loose because the API defines their several shapes, not Claude Code.
  citations: z.array(z.unknown()).nullable().optional(),
  cache_control: cacheControl,
});

const imageSource = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('base64'),
    media_type: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
    data: z.string(),
  }),
  z.looseObject({ type: z.literal('url'), url: z.string() }),
  z.looseObject({ type: z.literal('file'), file_id: z.string() }),
]);

const imageBlock = z.looseObject({
  type: z.literal('image'),
  source: imageSource,
  cache_control: cacheControl,
});

const documentSource = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('base64'),
    media_type: z.literal('application/pdf'),
    data: z.string(),
  }),
  z.looseObject({ type: z.literal('text'), media_type: z.literal('text/plain'), data: z.string() }),
  z.looseObject({
    type: z.literal('content'),
    content: z.union([z.string(), z.array(z.discriminatedUnion('type', [textBlock, imageBlock]))]),
  }),
  z.looseObject({ type: z.literal('url'), url: z.string() }),
  z.looseObject({ type: z.literal('file'), file_id: z.string() }),
]);

const documentBlock = z.looseObject({
  type: z.literal('document'),
  source: documentSource,
  title: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  citations: z.looseObject({ enabled: z.boolean().optional() }).nullable().optional(),
  cache_control: cacheControl,
});

const searchResultBlock = z.looseObject({
  type: z.literal('search_result'),
  source: z.string(),
  title: z.string(),
  content: z.array(textBlock),
  citations: z.looseObject({ enabled: z.boolean().optional() }).optional(),
  cache_control: cacheControl,
});

const toolReferenceBlock = z.looseObject({
  type: z.literal('tool_reference'),
  tool_name: z.string(),
});

const toolResultContentBlock = z.discriminatedUnion('type', [
  textBlock,
  imageBlock,
  searchResultBlock,
  documentBlock,
  toolReferenceBlock,
]);

const toolResultBlock = z.looseObject({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  // A string, or text / image / search_result / document / tool_reference blocks.
  content: z.union([z.string(), z.array(toolResultContentBlock)]).optional(),
  is_error: z.boolean().optional(),
  cache_control: cacheControl,
});

const thinkingBlock = z.looseObject({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.string(),
});

const redactedThinkingBlock = z.looseObject({
  type: z.literal('redacted_thinking'),
  data: z.string(),
});

/**
 * Who invoked a tool. `direct` is the model itself; a server-side code
 * execution caller carries a dated type name (`code_execution_<date>`), so the
 * set is open and stays a string.
 */
const toolCaller = z.looseObject({ type: z.string() });

const toolUseBlock = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  // The named tool's input object; its shape is that tool's own schema.
  input: looseRecord,
  caller: toolCaller.optional(),
  cache_control: cacheControl,
});

/** The server-executed tools a `server_tool_use` block can name. */
export const claudeSessionServerToolNames = [
  'advisor',
  'web_search',
  'web_fetch',
  'code_execution',
  'bash_code_execution',
  'text_editor_code_execution',
  'tool_search_tool_regex',
  'tool_search_tool_bm25',
] as const;

const serverToolUseBlock = z.looseObject({
  type: z.literal('server_tool_use'),
  id: z.string(),
  name: z.enum(claudeSessionServerToolNames),
  input: looseRecord,
  caller: toolCaller.optional(),
});

const advisorToolResultBlock = z.looseObject({
  type: z.literal('advisor_tool_result'),
  tool_use_id: z.string(),
  content: z.discriminatedUnion('type', [
    z.looseObject({ type: z.literal('advisor_redacted_result'), encrypted_content: z.string() }),
    z.looseObject({
      type: z.literal('advisor_tool_result_error'),
      error_code: z.enum([
        'too_many_requests',
        'overloaded',
        'execution_time_exceeded',
        'unavailable',
      ]),
    }),
  ]),
});

/** Written when the session switched to a fallback model mid-response. */
const fallbackBlock = z.looseObject({
  type: z.literal('fallback'),
  from: z.looseObject({ model: z.string() }),
  to: z.looseObject({ model: z.string() }),
});

const serverResultBlocks = [
  taggedBlock('web_search_tool_result'),
  taggedBlock('web_fetch_tool_result'),
  taggedBlock('code_execution_tool_result'),
  taggedBlock('bash_code_execution_tool_result'),
  taggedBlock('text_editor_code_execution_tool_result'),
  taggedBlock('tool_search_tool_result'),
  taggedBlock('mcp_tool_use'),
  taggedBlock('mcp_tool_result'),
  taggedBlock('container_upload'),
  taggedBlock('compaction'),
] as const;

/** A block in an `assistant` record's `message.content`. */
export const claudeSessionAssistantContentBlockSchema = z.discriminatedUnion('type', [
  textBlock,
  toolUseBlock,
  thinkingBlock,
  redactedThinkingBlock,
  serverToolUseBlock,
  advisorToolResultBlock,
  fallbackBlock,
  ...serverResultBlocks,
]);
export type ClaudeSessionAssistantContentBlock = z.infer<
  typeof claudeSessionAssistantContentBlockSchema
>;

/** A block in a `user` record's `message.content`. */
export const claudeSessionUserContentBlockSchema = z.discriminatedUnion('type', [
  textBlock,
  imageBlock,
  documentBlock,
  searchResultBlock,
  toolResultBlock,
  toolUseBlock,
  thinkingBlock,
  redactedThinkingBlock,
  taggedBlock('mid_conv_system'),
  ...serverResultBlocks,
  serverToolUseBlock,
  advisorToolResultBlock,
  fallbackBlock,
]);
export type ClaudeSessionUserContentBlock = z.infer<typeof claudeSessionUserContentBlockSchema>;
