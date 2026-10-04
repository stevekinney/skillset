import { describe, expect, it } from 'bun:test';

import {
  claudeSessionAttachmentRecordSchema,
  claudeSessionAttachmentSchema,
  claudeSessionUnobservedAttachmentTypes,
} from './claude-session-attachment-schemas.js';

const memoryFile = { type: 'Project', path: '/p/CLAUDE.md', content: 'text' };

/** One hand-written body per attachment type this schema models in full. */
const bodies: Record<string, Record<string, unknown>> = {
  advisor_tool: { available: true, model: 'm', toolChange: 'add' },
  agent_listing_delta: {
    addedLines: ['- a'],
    addedTypes: ['a'],
    builtInTypes: ['Explore'],
    isInitial: true,
    removedTypes: [],
    showConcurrencyNote: true,
  },
  agent_mention: { agentType: 'a' },
  compact_file_reference: { displayPath: 'x.log', filename: '/tmp/x.log' },
  credential_org: { organizationUuid: 'o-1' },
  date: { date: '2026-01-01', changed: true },
  date_change: { newDate: '2026-01-02' },
  deferred_tools_delta: {
    addedLines: [],
    addedNames: [],
    readdedNames: [],
    removedNames: [],
    surfacedNames: ['x'],
    wireHiddenNames: [],
    pendingMcpServers: ['s'],
    needsAuthMcpServers: ['s'],
    failedMcpServers: [
      { name: 's', error: 'boom', errorCode: 'AUTH_HEADER_REJECTED' },
      { name: 't' },
    ],
  },
  deferred_tools_record: {
    entries: [
      {
        name: 'tool',
        description: 'd',
        defer_loading: true,
        eager_input_streaming: true,
        input_schema: { type: 'object' },
      },
    ],
    nameOnlyAnnouncements: ['tool'],
    toolInputCopies: [{ id: 't-1', copy: 'wire' }],
  },
  diagnostics: {
    isNew: true,
    files: [
      {
        uri: 'file:///a.ts',
        diagnostics: [
          {
            code: '2304',
            message: 'm',
            severity: 'Error',
            source: 'typescript',
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
          },
        ],
      },
    ],
  },
  directory: { content: 'listing', displayPath: 'src', path: '/work/src' },
  dynamic_skill: {
    displayPath: '.claude/skills',
    skillDir: '/work/.claude/skills',
    skillNames: ['a'],
  },
  edited_text_file: { filename: '/work/a.ts', snippet: '1\tline' },
  environment: {
    changes: [{ field: 'workingDirectory', from: '/a', to: '/b' }],
    snapshot: {
      workingDirectory: '/work',
      additionalWorkingDirectories: [],
      scratchpadDirectory: '/tmp/s',
      isGitRepo: true,
      isWorktree: false,
      platform: 'darwin',
      osVersion: 'Darwin 27.0.0',
      shell: 'zsh',
    },
  },
  file: {
    displayPath: 'a.ts',
    filename: '/work/a.ts',
    content: {
      type: 'text',
      file: { filePath: '/work/a.ts', content: 'x', numLines: 1, startLine: 1, totalLines: 1 },
    },
  },
  instructions: { changed: true, reason: 'compaction', files: [memoryFile] },
  invoked_skills: { skills: [{ name: 's', path: '/s/SKILL.md', content: 'c' }] },
  mcp_instructions_delta: { addedBlocks: ['b'], addedNames: ['n'], removedNames: [] },
  model: {
    text: 't',
    identity: { knowledgeCutoff: 'June 2026', marketingName: 'M', modelId: 'm' },
  },
  nested_memory: {
    displayPath: 'CLAUDE.md',
    path: '/work/CLAUDE.md',
    content: {
      ...memoryFile,
      contentDiffersFromDisk: false,
      globs: ['*.ts'],
      parent: '/CLAUDE.md',
      rawContent: 'raw',
    },
  },
  output_style: { style: 'Explanatory' },
  output_style_instructions: { style: { name: 'Explanatory', prompt: 'p' } },
  prompt_snapshot: {
    systemPrompt: ['s'],
    cliPrefix: 'p',
    contextRendering: 'announced',
    echoWireToolInputs: true,
    hostPrompt: 'h',
    inlineTools: false,
    keptReminders: true,
    reminderFold: false,
    systemTurns: true,
    toolChangeHeader: true,
    tools: [{ name: 'Bash', description: 'd', server: 'srv', schema: { type: 'object' } }],
  },
  session_context: {
    changed: true,
    reason: 'session_start',
    context: { userEmail: 'a@example.test', gitStatus: 'clean' },
  },
  skill_listing: { content: 'c', isInitial: true, names: ['a'], skillCount: 1 },
  structured_output: { data: { anything: 1 }, toolUseID: 't-1' },
};

describe('claudeSessionAttachmentSchema', () => {
  for (const [type, body] of Object.entries(bodies)) {
    it(`parses a ${type} attachment`, () => {
      expect(claudeSessionAttachmentSchema.safeParse({ type, ...body }).success).toBe(true);
    });
  }

  for (const type of claudeSessionUnobservedAttachmentTypes) {
    it(`accepts the ${type} attachment by its tag alone`, () => {
      expect(claudeSessionAttachmentSchema.safeParse({ type, anything: 1 }).success).toBe(true);
    });
  }

  it('does not list a type twice', () => {
    const names = [...Object.keys(bodies), ...claudeSessionUnobservedAttachmentTypes];
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects an unknown type, a bad enum value and a missing field', () => {
    expect(claudeSessionAttachmentSchema.safeParse({ type: 'later' }).success).toBe(false);
    expect(
      claudeSessionAttachmentSchema.safeParse({
        type: 'environment',
        snapshot: {
          workingDirectory: '/work',
          additionalWorkingDirectories: [],
          isGitRepo: true,
          isWorktree: false,
          platform: 'plan9',
          osVersion: 'x',
          shell: 'zsh',
        },
      }).success,
    ).toBe(false);
    expect(claudeSessionAttachmentSchema.safeParse({ type: 'date' }).success).toBe(false);
  });
});

describe('claudeSessionAttachmentRecordSchema', () => {
  const chain = {
    type: 'attachment',
    uuid: 'u-1',
    parentUuid: null,
    sessionId: 's-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    isSidechain: false,
    userType: 'external',
    cwd: '/work',
    version: '2.1.288',
  };

  it('parses a record with its rendering fields', () => {
    const record = claudeSessionAttachmentRecordSchema.parse({
      ...chain,
      attachment: { type: 'output_style', style: 'Explanatory' },
      rendered: [{ content: 'a' }],
      renderedInHumanTurn: [{ content: 'b' }],
      renderedBesideToolResult: true,
      renderedRole: 'system',
    });
    expect(record.attachment.type).toBe('output_style');
  });

  it('rejects a record whose attachment is not one of the known shapes', () => {
    expect(
      claudeSessionAttachmentRecordSchema.safeParse({ ...chain, attachment: { type: 'nope' } })
        .success,
    ).toBe(false);
  });
});
