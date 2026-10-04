import { z } from 'zod';

import { imageDetailSchema } from './codex-session-content.js';

/**
 * Building blocks for the `TurnItem` variants in `codex-session-turn-items.ts`
 * (see that module for the sources and what was left loose).
 */

export const status = {
  inProgress: z.enum(['in_progress', 'completed', 'failed']),
  collab: z.enum(['in_progress', 'completed', 'failed', 'interrupted']),
};

export const nullableString = z.string().nullable();

export const userInputSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('text'),
    text: z.string(),
    text_elements: z
      .array(
        z.looseObject({
          byte_range: z.looseObject({ start: z.number(), end: z.number() }),
          placeholder: nullableString.optional(),
        }),
      )
      .optional(),
  }),
  z.looseObject({
    type: z.literal('image'),
    image_url: z.string().optional(),
    file_id: z.string().optional(),
    detail: imageDetailSchema.optional(),
  }),
  z.looseObject({
    type: z.literal('local_image'),
    path: z.string(),
    detail: imageDetailSchema.optional(),
  }),
  z.looseObject({ type: z.literal('audio'), audio_url: z.string() }),
  z.looseObject({ type: z.literal('local_audio'), path: z.string() }),
  z.looseObject({ type: z.literal('skill'), name: z.string(), path: z.string() }),
  z.looseObject({ type: z.literal('mention'), name: z.string(), path: z.string() }),
]);

export const parsedCommandSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('read'), cmd: z.string(), name: z.string(), path: z.string() }),
  z.looseObject({
    type: z.literal('list_files'),
    cmd: z.string(),
    path: nullableString.optional(),
  }),
  z.looseObject({
    type: z.literal('search'),
    cmd: z.string(),
    query: nullableString.optional(),
    path: nullableString.optional(),
  }),
  z.looseObject({ type: z.literal('unknown'), cmd: z.string() }),
]);

/** `AgentStatus`: a bare string for unit variants, a one-key object for the data variants. */
export const agentStatusSchema = z.union([
  z.enum(['pending_init', 'running', 'interrupted', 'shutdown', 'not_found']),
  z.looseObject({ completed: nullableString }),
  z.looseObject({ errored: z.string() }),
]);

export const reviewTargetSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('uncommittedChanges') }),
  z.looseObject({ type: z.literal('baseBranch'), branch: z.string() }),
  z.looseObject({ type: z.literal('commit'), sha: z.string(), title: nullableString }),
  z.looseObject({ type: z.literal('custom'), instructions: z.string() }),
]);

export const reviewOutputSchema = z.looseObject({
  findings: z.array(
    z.looseObject({
      title: z.string(),
      body: z.string(),
      confidence_score: z.number(),
      priority: z.number(),
      code_location: z.looseObject({
        absolute_file_path: z.string(),
        line_range: z.looseObject({ start: z.number(), end: z.number() }),
      }),
    }),
  ),
  overall_correctness: z.string(),
  overall_explanation: z.string(),
  overall_confidence_score: z.number(),
});

export const fileChangeSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('add'), content: z.string() }),
  z.looseObject({ type: z.literal('delete'), content: z.string() }),
  z.looseObject({
    type: z.literal('update'),
    unified_diff: z.string(),
    move_path: nullableString,
  }),
]);

/** One search hit; Rust types `results` as raw JSON, so every key but `type` is optional. */
export const searchResultSchema = z.looseObject({
  type: z.string(),
  ref_id: z.string(),
  domain: z.string().optional(),
  snippet: z.string().optional(),
  thumbnail_url: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

/** The extension item's web search action (camelCase, unlike the Responses API one). */
export const extensionSearchActionSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('search'),
    query: nullableString.optional(),
    queries: z.array(z.string()).nullable().optional(),
  }),
  z.looseObject({ type: z.literal('openPage'), url: nullableString.optional() }),
  z.looseObject({
    type: z.literal('findInPage'),
    url: nullableString.optional(),
    pattern: nullableString.optional(),
  }),
  z.looseObject({ type: z.literal('other') }),
]);

export const extensionItemSchema = z.discriminatedUnion('kind', [
  z.looseObject({
    type: z.literal('Extension'),
    kind: z.literal('web.search'),
    id: z.string(),
    query: z.string(),
    action: extensionSearchActionSchema.nullable().optional(),
    results: z.array(searchResultSchema).nullable().optional(),
  }),
  z.looseObject({
    type: z.literal('Extension'),
    kind: z.literal('clock.sleep'),
    id: z.string(),
    durationMs: z.number(),
  }),
  z.looseObject({
    type: z.literal('Extension'),
    kind: z.literal('image_gen.generation'),
    id: z.string(),
    status: z.enum(['in_progress', 'generating', 'completed', 'failed']),
    revisedPrompt: nullableString,
    result: z.string(),
    transparentBackground: z.boolean().nullable().optional(),
    failure: z
      .looseObject({
        type: z.literal('usageLimitExceeded'),
        limitId: z.string(),
        resetsAt: z.number().nullable(),
      })
      .nullable()
      .optional(),
    savedPath: z.string().optional(),
  }),
]);
