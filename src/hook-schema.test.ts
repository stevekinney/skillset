import { describe, expect, it } from 'bun:test';

import {
  claudeHandlerProblems,
  claudeHookSettingsSchema,
  codexHandlerProblems,
  codexHookFindings,
  codexHookSettingsSchema,
  codexRunsHandlerType,
  unknownClaudeHandlerFields,
  unknownClaudeHookFields,
  unknownCodexHandlerFields,
} from './hook-schema.js';

const invalidCodexHooks = (value: unknown): boolean =>
  !codexHookSettingsSchema.safeParse(value).success;

describe('claudeHookSettingsSchema', () => {
  it('parses every Claude Code handler type', () => {
    const settings = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: './check.sh',
              args: ['--strict'],
              shell: 'bash',
              if: 'Bash(git *)',
              timeout: 2.5,
              statusMessage: 'Checking…',
              once: true,
              async: false,
              asyncRewake: true,
              rewakeMessage: 'Check failed',
              rewakeSummary: 'check',
              cloud: 'device',
            },
            {
              type: 'http',
              url: 'https://hooks.example.com/pre',
              headers: { Authorization: 'Bearer $TOKEN' },
              allowedEnvVars: ['TOKEN'],
            },
            {
              type: 'mcp_tool',
              server: 'audit',
              tool: 'record',
              input: { path: '${tool_input.file_path}' },
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'prompt',
              prompt: 'Is the task done? $ARGUMENTS',
              model: 'claude-haiku-4-5',
              continueOnBlock: true,
            },
            { type: 'agent', prompt: 'Verify the tests ran.', model: 'claude-sonnet-5-5' },
          ],
        },
      ],
    };

    expect(claudeHookSettingsSchema.parse(settings) as unknown).toEqual(settings);
  });

  it('rejects unknown events, unknown handler types, and missing required fields', () => {
    const handler = { type: 'command', command: 'x' };
    expect(() => claudeHookSettingsSchema.parse({ OnSneeze: [{ hooks: [handler] }] })).toThrow();
    expect(() =>
      claudeHookSettingsSchema.parse({ Stop: [{ hooks: [{ type: 'webhook' }] }] }),
    ).toThrow();
    expect(() =>
      claudeHookSettingsSchema.parse({ Stop: [{ hooks: [{ type: 'http' }] }] }),
    ).toThrow();
    expect(() =>
      claudeHookSettingsSchema.parse({ Stop: [{ hooks: [{ command: 'x' }] }] }),
    ).toThrow();
    expect(() =>
      claudeHookSettingsSchema.parse({ Stop: [{ hooks: [{ ...handler, timeout: 0 }] }] }),
    ).toThrow();
    expect(() =>
      claudeHookSettingsSchema.parse({ Stop: [{ hooks: [{ type: 'http', url: 'not a url' }] }] }),
    ).toThrow();
  });

  it('keeps unknown fields so emitted output matches the source', () => {
    const settings = {
      Stop: [{ matcher: '', extra: 1, hooks: [{ type: 'command', command: 'x', comand: 'y' }] }],
    };
    expect(claudeHookSettingsSchema.parse(settings) as unknown).toEqual(settings);
  });
});

describe('unknownClaudeHookFields', () => {
  it('names every field Claude Code does not read, by path', () => {
    const settings = claudeHookSettingsSchema.parse({
      Stop: [
        { extra: 1, hooks: [{ type: 'command', command: 'x', comand: 'y' }] },
        { hooks: [{ type: 'prompt', prompt: 'p', args: [] }] },
      ],
    });
    expect(unknownClaudeHookFields(settings)).toEqual([
      'hooks.Stop[0].extra',
      'hooks.Stop[0].hooks[0].comand',
      'hooks.Stop[1].hooks[0].args',
    ]);
  });

  it('returns nothing for clean settings', () => {
    expect(
      unknownClaudeHookFields(
        claudeHookSettingsSchema.parse({ Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }),
      ),
    ).toEqual([]);
  });
});

describe('handler validation helpers', () => {
  it('validates Claude handlers by type and requires the type literal', () => {
    expect(claudeHandlerProblems({ type: 'command', command: 'x' })).toEqual([]);
    expect(claudeHandlerProblems({ command: 'x' })[0]?.path).toEqual(['type']);
    expect(claudeHandlerProblems({ type: 'http', url: 'nope' })[0]?.path).toEqual(['url']);
    expect(claudeHandlerProblems({ type: 'mystery' })[0]?.message).toContain(
      'unknown handler type',
    );
    expect(unknownClaudeHandlerFields({ type: 'command', command: 'x', mystery: 1 })).toEqual([
      'mystery',
    ]);
    expect(unknownClaudeHandlerFields({ type: 'mystery', a: 1 })).toEqual([]);
  });

  it('validates Codex handlers by type', () => {
    expect(codexHandlerProblems({ type: 'command', command: 'x', timeout: 5 })).toEqual([]);
    expect(codexHandlerProblems({ type: 'command', command: '' })[0]?.path).toEqual(['command']);
    expect(codexHandlerProblems({ type: 'command', command: 'x', timeout: 1.5 })).toHaveLength(1);
    expect(codexHandlerProblems({ type: 'mcp_tool', server: 's' })[0]?.path).toEqual(['tool']);
    expect(codexHandlerProblems({ type: 'prompt', prompt: 'anything' })).toEqual([]);
    expect(codexHandlerProblems({ type: 'mystery' })).toEqual([]);
    expect(unknownCodexHandlerFields({ command: 'x', if: 'y', command_windows: 'z' })).toEqual([
      'if',
    ]);
    expect(unknownCodexHandlerFields({ type: 'prompt', prompt: 'x' })).toEqual([]);
    expect(unknownCodexHandlerFields({ type: 'mystery', a: 1 })).toEqual([]);
    expect(codexRunsHandlerType('command')).toBe(true);
    expect(codexRunsHandlerType('mcp_tool')).toBe(true);
    expect(codexRunsHandlerType('prompt')).toBe(false);
    expect(codexRunsHandlerType('mystery')).toBe(false);
  });
});

describe('codexHookSettingsSchema', () => {
  const settings = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: './check.sh', timeout: 5, async: true },
          { type: 'mcp_tool', server: 'audit', tool: 'record', input: { a: 1 } },
        ],
      },
      { matcher: null },
    ],
    Interrupt: [{ hooks: [] }],
    state: { 'user:PreToolUse:0:0': { enabled: true, trusted_hash: 'abc' } },
  };

  it('parses every Codex handler type and the state table', () => {
    expect(codexHookSettingsSchema.parse(settings)).toEqual(settings);
    expect(codexHookSettingsSchema.parse({})).toEqual({});
  });

  it('rejects invalid handlers and wrong shapes', () => {
    expect(invalidCodexHooks({ PreToolUse: [{ hooks: [{ type: 'command' }] }] })).toBe(true);
    expect(
      invalidCodexHooks({ PreToolUse: [{ hooks: [{ type: 'mcp_tool', server: '', tool: 't' }] }] }),
    ).toBe(true);
    expect(invalidCodexHooks({ PreToolUse: [{ hooks: [{ command: 'x' }] }] })).toBe(true);
    expect(invalidCodexHooks({ PreToolUse: { hooks: [] } })).toBe(true);
    expect(invalidCodexHooks({ state: { key: { enabled: 'yes' } } })).toBe(true);
  });

  it('keeps handlers with an unrecognised type for doctor to flag', () => {
    expect(
      codexHookSettingsSchema.safeParse({ Stop: [{ hooks: [{ type: 'mystery' }] }] }).success,
    ).toBe(true);
  });

  it('reports unknown fields, unknown types, and skipped handlers', () => {
    const findings = codexHookFindings(
      codexHookSettingsSchema.parse({
        Sneeze: [],
        Stop: [
          {
            colour: 'red',
            hooks: [
              { type: 'command', command: 'x', if: 'y' },
              { type: 'mystery' },
              { type: 'prompt', prompt: 'p' },
              { type: 'agent' },
            ],
          },
        ],
      }),
    );
    expect(findings.unknownFields).toEqual([
      'hooks.Stop[0].colour',
      'hooks.Stop[0].hooks[0].if',
      'hooks.Sneeze',
    ]);
    expect(findings.unknownTypes).toEqual(['hooks.Stop[0].hooks[1]']);
    expect(findings.skippedHandlers).toEqual(['hooks.Stop[0].hooks[2]', 'hooks.Stop[0].hooks[3]']);
    expect(codexHookFindings({})).toEqual({
      unknownFields: [],
      unknownTypes: [],
      skippedHandlers: [],
    });
  });
});
