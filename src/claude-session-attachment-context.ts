import { z } from 'zod';

import { looseRecord } from './claude-session-shared.js';

/**
 * Attachment variants that inject context into a turn: environment, model,
 * instructions, skills, agents, tools, MCP servers and files. Each is the
 * body of an `attachment` record, discriminated on `type`.
 */

/** One attachment variant: the `type` tag plus its fields, loose so new fields never fail a parse. */
export function attachmentVariant<Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) {
  return z.looseObject({ type: z.literal(type), ...shape });
}

const strings = z.array(z.string());

/** Why an MCP server failed to connect. */
const mcpErrorCodes = [
  'AUTH_HEADER_REJECTED',
  'CLAUDEAI_BEARER_REJECTED',
  'FIRST_PARTY_AUTH_REJECTED',
  'APPROVAL_REQUIRED',
] as const;

const environmentChange = z.looseObject({
  field: z.enum([
    'workingDirectory',
    'isWorktree',
    'additionalWorkingDirectories',
    'scratchpadDirectory',
  ]),
  added: strings.optional(),
  removed: strings.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const diagnosticPosition = z.looseObject({ line: z.number(), character: z.number() });

/**
 * Where a loaded memory file came from. `User`, `Project` and `AutoMem` appear
 * in real sessions and `Managed` in the binary's loader; `Local`
 * (`CLAUDE.local.md`) and `TeamMem` are taken from Claude Code's memory-type
 * list and not confirmed against this machine's data or the binary.
 */
const memoryFileTypes = ['Managed', 'User', 'Project', 'Local', 'AutoMem', 'TeamMem'] as const;

const instructionFile = z.looseObject({
  type: z.enum(memoryFileTypes),
  path: z.string(),
  content: z.string(),
});

/** The context-injecting attachment variants. */
export const claudeSessionContextAttachments = [
  attachmentVariant('advisor_tool', {
    available: z.boolean(),
    model: z.string(),
    toolChange: z.enum(['add']).optional(),
  }),
  attachmentVariant('agent_listing_delta', {
    addedLines: strings,
    addedTypes: strings,
    builtInTypes: strings.optional(),
    isInitial: z.boolean(),
    removedTypes: strings,
    showConcurrencyNote: z.boolean(),
  }),
  attachmentVariant('agent_mention', { agentType: z.string() }),
  attachmentVariant('compact_file_reference', { displayPath: z.string(), filename: z.string() }),
  attachmentVariant('credential_org', { organizationUuid: z.string() }),
  attachmentVariant('date', { changed: z.boolean().optional(), date: z.string() }),
  attachmentVariant('date_change', { newDate: z.string() }),
  attachmentVariant('deferred_tools_delta', {
    addedLines: strings,
    addedNames: strings,
    readdedNames: strings,
    removedNames: strings,
    surfacedNames: strings.optional(),
    wireHiddenNames: strings.optional(),
    pendingMcpServers: strings.optional(),
    needsAuthMcpServers: strings.optional(),
    failedMcpServers: z
      .array(
        z.looseObject({
          name: z.string(),
          error: z.string().optional(),
          errorCode: z.enum(mcpErrorCodes).optional(),
        }),
      )
      .optional(),
  }),
  attachmentVariant('deferred_tools_record', {
    entries: z.array(
      z.looseObject({
        name: z.string(),
        description: z.string(),
        defer_loading: z.boolean().optional(),
        eager_input_streaming: z.boolean().optional(),
        // The tool's JSON Schema; left loose because it is the tool's own schema, not Claude Code's.
        input_schema: looseRecord,
      }),
    ),
    nameOnlyAnnouncements: strings.optional(),
    toolInputCopies: z
      .array(z.looseObject({ id: z.string(), copy: z.enum(['wire', 'displayed']) }))
      .optional(),
  }),
  attachmentVariant('diagnostics', {
    isNew: z.boolean(),
    files: z.array(
      z.looseObject({
        uri: z.string(),
        diagnostics: z.array(
          z.looseObject({
            code: z.string().optional(),
            message: z.string(),
            severity: z.enum(['Error', 'Warning', 'Info', 'Hint']),
            source: z.string().optional(),
            range: z.looseObject({ start: diagnosticPosition, end: diagnosticPosition }),
          }),
        ),
      }),
    ),
  }),
  attachmentVariant('directory', {
    content: z.string(),
    displayPath: z.string(),
    path: z.string(),
  }),
  attachmentVariant('dynamic_skill', {
    displayPath: z.string(),
    skillDir: z.string(),
    skillNames: strings,
  }),
  attachmentVariant('edited_text_file', { filename: z.string(), snippet: z.string() }),
  attachmentVariant('environment', {
    changes: z.array(environmentChange).optional(),
    snapshot: z.looseObject({
      workingDirectory: z.string(),
      additionalWorkingDirectories: strings,
      scratchpadDirectory: z.string().optional(),
      isGitRepo: z.boolean(),
      isWorktree: z.boolean(),
      // Node's `process.platform` values.
      platform: z.enum([
        'aix',
        'android',
        'cygwin',
        'darwin',
        'freebsd',
        'haiku',
        'linux',
        'netbsd',
        'openbsd',
        'sunos',
        'win32',
      ]),
      osVersion: z.string(),
      shell: z.string(),
    }),
  }),
  attachmentVariant('file', {
    displayPath: z.string(),
    filename: z.string(),
    content: z.looseObject({
      type: z.literal('text'),
      file: z.looseObject({
        filePath: z.string(),
        content: z.string(),
        numLines: z.number(),
        startLine: z.number(),
        totalLines: z.number(),
      }),
    }),
  }),
  attachmentVariant('instructions', {
    changed: z.boolean().optional(),
    reason: z.enum(['compaction', 'session_start']).optional(),
    files: z.array(instructionFile),
  }),
  attachmentVariant('invoked_skills', {
    skills: z.array(z.looseObject({ name: z.string(), path: z.string(), content: z.string() })),
  }),
  attachmentVariant('mcp_instructions_delta', {
    addedBlocks: strings,
    addedNames: strings,
    removedNames: strings,
  }),
  attachmentVariant('model', {
    text: z.string(),
    identity: z.looseObject({
      knowledgeCutoff: z.string(),
      marketingName: z.string(),
      modelId: z.string(),
    }),
  }),
  attachmentVariant('nested_memory', {
    displayPath: z.string(),
    path: z.string(),
    content: z.looseObject({
      type: z.enum(memoryFileTypes),
      path: z.string(),
      content: z.string(),
      contentDiffersFromDisk: z.boolean(),
      globs: strings.optional(),
      parent: z.string().optional(),
      rawContent: z.string().optional(),
    }),
  }),
  attachmentVariant('output_style', { style: z.string() }),
  attachmentVariant('output_style_instructions', {
    style: z.looseObject({ name: z.string(), prompt: z.string() }),
  }),
  attachmentVariant('prompt_snapshot', {
    systemPrompt: strings,
    cliPrefix: z.string().optional(),
    contextRendering: z.enum(['announced']).optional(),
    echoWireToolInputs: z.boolean().optional(),
    hostPrompt: z.string().optional(),
    inlineTools: z.boolean().optional(),
    keptReminders: z.boolean().optional(),
    reminderFold: z.boolean().optional(),
    systemTurns: z.boolean().optional(),
    toolChangeHeader: z.boolean().optional(),
    tools: z
      .array(
        z.looseObject({
          name: z.string(),
          description: z.string(),
          server: z.string().optional(),
          schema: looseRecord.optional(),
        }),
      )
      .optional(),
  }),
  attachmentVariant('session_context', {
    changed: z.boolean().optional(),
    reason: z.enum(['session_start']).optional(),
    context: z.looseObject({ userEmail: z.string(), gitStatus: z.string().optional() }),
  }),
  attachmentVariant('skill_listing', {
    content: z.string(),
    isInitial: z.boolean(),
    names: strings,
    skillCount: z.number(),
  }),
  attachmentVariant('structured_output', {
    // The agent's own structured result; its shape is whatever schema the caller asked for.
    data: looseRecord,
    toolUseID: z.string().optional(),
  }),
] as const;
