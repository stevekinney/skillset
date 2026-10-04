import { describe, expect, it } from 'bun:test';

import {
  claudeSessionAssistantContentBlockSchema,
  claudeSessionServerToolNames,
  claudeSessionUserContentBlockSchema,
} from './claude-session-content-blocks.js';
import {
  claudeSessionAssistantMessageSchema,
  claudeSessionUsageSchema,
  claudeSessionUserMessageSchema,
} from './claude-session-message-schemas.js';

const tokens = {
  input_tokens: 1,
  output_tokens: 2,
  cache_creation_input_tokens: 3,
  cache_read_input_tokens: 4,
};
const cacheCreation = { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 3 };

describe('assistant content blocks', () => {
  const blocks: Record<string, Record<string, unknown>> = {
    text: {
      text: 'hi',
      citations: [{ type: 'char_location' }],
      cache_control: { type: 'ephemeral' },
    },
    tool_use: { id: 't-1', name: 'Bash', input: { command: 'ls' }, caller: { type: 'direct' } },
    thinking: { thinking: 'hmm', signature: 'sig' },
    redacted_thinking: { data: 'opaque' },
    server_tool_use: { id: 's-1', name: 'advisor', input: {} },
    advisor_tool_result: {
      tool_use_id: 's-1',
      content: { type: 'advisor_redacted_result', encrypted_content: 'x' },
    },
    fallback: { from: { model: 'a' }, to: { model: 'b' } },
    web_search_tool_result: { tool_use_id: 's-2', content: [] },
    web_fetch_tool_result: {},
    code_execution_tool_result: {},
    bash_code_execution_tool_result: {},
    text_editor_code_execution_tool_result: {},
    tool_search_tool_result: {},
    mcp_tool_use: {},
    mcp_tool_result: {},
    container_upload: {},
    compaction: {},
  };

  for (const [type, body] of Object.entries(blocks)) {
    it(`parses a ${type} block`, () => {
      expect(claudeSessionAssistantContentBlockSchema.safeParse({ type, ...body }).success).toBe(
        true,
      );
    });
  }

  it('parses an advisor error result and every server tool name', () => {
    const error = {
      type: 'advisor_tool_result',
      tool_use_id: 's-1',
      content: { type: 'advisor_tool_result_error', error_code: 'overloaded' },
    };
    expect(claudeSessionAssistantContentBlockSchema.safeParse(error).success).toBe(true);
    for (const name of claudeSessionServerToolNames) {
      expect(
        claudeSessionAssistantContentBlockSchema.safeParse({
          type: 'server_tool_use',
          id: 's',
          name,
          input: {},
        }).success,
      ).toBe(true);
    }
  });

  it('rejects an unknown block type, an unknown server tool and an unknown advisor error', () => {
    expect(claudeSessionAssistantContentBlockSchema.safeParse({ type: 'later' }).success).toBe(
      false,
    );
    expect(
      claudeSessionAssistantContentBlockSchema.safeParse({
        type: 'server_tool_use',
        id: 's',
        name: 'toaster',
        input: {},
      }).success,
    ).toBe(false);
    expect(
      claudeSessionAssistantContentBlockSchema.safeParse({
        type: 'advisor_tool_result',
        tool_use_id: 's',
        content: { type: 'advisor_tool_result_error', error_code: 'melted' },
      }).success,
    ).toBe(false);
  });
});

describe('user content blocks', () => {
  const image = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
  };
  const text = { type: 'text', text: 'a' };

  const blocks: Record<string, unknown> = {
    text,
    image,
    imageByUrl: { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
    imageByFile: { type: 'image', source: { type: 'file', file_id: 'f-1' } },
    documentPdf: {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' },
      title: 'T',
      context: null,
      citations: { enabled: true },
    },
    documentText: {
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: 'body' },
    },
    documentBlocks: { type: 'document', source: { type: 'content', content: 'inline' } },
    documentBlockList: { type: 'document', source: { type: 'content', content: [text, image] } },
    documentUrl: { type: 'document', source: { type: 'url', url: 'https://example.test/a.pdf' } },
    documentFile: { type: 'document', source: { type: 'file', file_id: 'f-1' } },
    searchResult: { type: 'search_result', source: 's', title: 't', content: [text] },
    toolResultText: { type: 'tool_result', tool_use_id: 't-1', content: 'out', is_error: false },
    toolResultBlocks: {
      type: 'tool_result',
      tool_use_id: 't-1',
      content: [text, image, { type: 'tool_reference', tool_name: 'Read' }],
    },
    toolResultEmpty: { type: 'tool_result', tool_use_id: 't-1' },
    toolUse: { type: 'tool_use', id: 't-1', name: 'Bash', input: {} },
    thinking: { type: 'thinking', thinking: 't', signature: 's' },
    redacted: { type: 'redacted_thinking', data: 'd' },
    midConversation: { type: 'mid_conv_system' },
    serverToolUse: { type: 'server_tool_use', id: 's', name: 'web_search', input: {} },
    advisorResult: {
      type: 'advisor_tool_result',
      tool_use_id: 's',
      content: { type: 'advisor_redacted_result', encrypted_content: 'x' },
    },
    fallback: { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    serverResult: { type: 'web_fetch_tool_result' },
  };

  for (const [name, block] of Object.entries(blocks)) {
    it(`parses a ${name} block`, () => {
      expect(claudeSessionUserContentBlockSchema.safeParse(block).success).toBe(true);
    });
  }

  it('rejects an image with an unknown media type and an unknown source type', () => {
    expect(
      claudeSessionUserContentBlockSchema.safeParse({
        type: 'image',
        source: { type: 'base64', media_type: 'image/bmp', data: 'A' },
      }).success,
    ).toBe(false);
    expect(
      claudeSessionUserContentBlockSchema.safeParse({ type: 'image', source: { type: 'ftp' } })
        .success,
    ).toBe(false);
  });
});

describe('claudeSessionUsageSchema', () => {
  it('parses a full usage object with every iteration kind', () => {
    const usage = {
      ...tokens,
      cache_creation: cacheCreation,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: 'standard',
      inference_geo: 'not_available',
      speed: 'fast',
      output_tokens_details: { thinking_tokens: 5 },
      fallback_credit: null,
      iterations: [
        { type: 'message', ...tokens, cache_creation: cacheCreation, model: null },
        { type: 'advisor_message', ...tokens, model: 'm' },
        { type: 'fallback_message', ...tokens, model: 'm' },
      ],
    };
    expect(claudeSessionUsageSchema.parse(usage)).toMatchObject({ speed: 'fast' });
  });

  it('parses the sparse usage of a synthetic message', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      service_tier: null,
      iterations: null,
    };
    expect(claudeSessionUsageSchema.safeParse(usage).success).toBe(true);
  });

  it('rejects a service tier it does not know', () => {
    expect(
      claudeSessionUsageSchema.safeParse({ ...tokens, service_tier: 'platinum' }).success,
    ).toBe(false);
  });
});

describe('message envelopes', () => {
  const assistant = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'a-model',
    content: [{ type: 'text', text: 'hi' }],
    stop_reason: 'tool_use',
    stop_sequence: '',
    stop_details: null,
    container: null,
    usage: tokens,
  };

  it('parses an assistant message with its diagnostics and transformations', () => {
    const parsed = claudeSessionAssistantMessageSchema.parse({
      ...assistant,
      context_management: { applied_edits: [{ type: 'clear' }] },
      diagnostics: {
        cache_miss_reason: { type: 'messages_changed', cache_missed_input_tokens: 5 },
      },
      input_transformations: [
        { type: 'thinking_dropped', path: 'messages[1]', reason: 'model_binding_mismatch' },
      ],
    });
    expect(parsed.stop_reason).toBe('tool_use');
  });

  it('allows a message that is still streaming and sparse nulls', () => {
    const parsed = claudeSessionAssistantMessageSchema.parse({
      ...assistant,
      stop_reason: null,
      context_management: null,
      diagnostics: null,
    });
    expect(parsed.stop_reason).toBeNull();
  });

  it('rejects a stop reason it does not know and a user role', () => {
    expect(
      claudeSessionAssistantMessageSchema.safeParse({ ...assistant, stop_reason: 'boredom' })
        .success,
    ).toBe(false);
    expect(
      claudeSessionAssistantMessageSchema.safeParse({ ...assistant, role: 'user' }).success,
    ).toBe(false);
  });

  it('parses a user message as a bare string or a block list', () => {
    expect(claudeSessionUserMessageSchema.safeParse({ role: 'user', content: 'x' }).success).toBe(
      true,
    );
    expect(
      claudeSessionUserMessageSchema.safeParse({
        role: 'user',
        content: [{ type: 'text', text: 'x' }],
      }).success,
    ).toBe(true);
    expect(claudeSessionUserMessageSchema.safeParse({ role: 'user', content: 7 }).success).toBe(
      false,
    );
  });
});
