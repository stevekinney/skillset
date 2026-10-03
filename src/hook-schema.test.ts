import { describe, expect, it } from 'bun:test';

import { claudeHookSettingsSchema, unknownClaudeHookFields } from './hook-schema.js';

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
