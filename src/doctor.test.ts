import { describe, expect, it } from 'bun:test';

import type { Target } from './frontmatter.js';
import { validateSkillMetadata, validateSubagentMetadata } from './validate-metadata.js';

function messages(raw: string, directoryName?: string, target: Target = 'claude'): string[] {
  return validateSkillMetadata(raw, {
    target,
    ...(directoryName === undefined ? {} : { directoryName }),
  }).issues.map((issue) => `${issue.severity}: ${issue.message}`);
}

function agentMessages(raw: string, fileName?: string): string[] {
  return validateSubagentMetadata(raw, fileName === undefined ? {} : { fileName }).issues.map(
    (issue) => `${issue.severity}: ${issue.message}`,
  );
}

const valid = '---\nname: good-skill\ndescription: Does a thing.\n---\n\nBody.\n';

function skillHooks(hooks: string): string {
  return `---\nname: good-skill\ndescription: Does a thing.\nhooks:\n${hooks}\n---\nBody.\n`;
}

function agentHooks(hooks: string): string {
  return `---\nname: reviewer\ndescription: Reviews code.\nhooks:\n${hooks}\n---\nYou review.\n`;
}

describe('skill rules', () => {
  it('passes a valid skill with no issues', () => {
    expect(messages(valid, 'good-skill')).toEqual([]);
  });

  it('accepts a Claude skill with no name, and warns when the description is missing', () => {
    expect(messages('---\nmodel: inherit\n---\nBody.\n')).toEqual([
      'warning: description is missing — Claude Code decides when to use a skill from it',
    ]);
  });

  it('requires name and description for Codex', () => {
    expect(messages('---\nmodel: inherit\n---\nBody.\n', undefined, 'codex')[0]).toStartWith(
      'error: invalid frontmatter — name:',
    );
  });

  it('reports schema violations with their field paths', () => {
    expect(messages('---\nname: good-skill\ndescription: ok\nmodel: [a]\n---\nbody')[0]).toContain(
      'model',
    );
  });

  it('validates the name format, length, and directory match', () => {
    const badFormat = messages('---\nname: Bad_Name\ndescription: ok\n---\nbody', 'bad-name');
    expect(badFormat).toContain(
      'error: name `Bad_Name` must be lowercase alphanumeric with single hyphens between words',
    );
    expect(badFormat).toContain('error: name `Bad_Name` must match its directory name `bad-name`');

    const longName = `x${'y'.repeat(70)}`;
    expect(messages(`---\nname: ${longName}\ndescription: ok\n---\nbody`)).toContain(
      'error: name exceeds 64 characters',
    );
  });

  it('warns on reserved words in the name', () => {
    expect(messages('---\nname: claude-pdf\ndescription: Reads PDFs.\n---\nbody')).toEqual([
      "warning: name contains reserved word `claude` — Claude's platform rejects it",
    ]);
  });

  it('validates the description', () => {
    expect(messages('---\nname: good-skill\ndescription: " "\n---\nbody')).toContain(
      'error: description must not be empty',
    );
    expect(
      messages(`---\nname: good-skill\ndescription: ${'x'.repeat(1100)}\n---\nbody`),
    ).toContain('error: description exceeds 1024 characters');
    expect(messages('---\nname: good-skill\ndescription: "uses <tags>"\n---\nbody')).toContain(
      'error: description must not contain XML tags',
    );
  });

  it('warns when SKILL.md exceeds 500 lines', () => {
    const body = Array.from({ length: 510 }, () => 'line').join('\n');
    expect(messages(`${valid}${body}`).join('\n')).toContain('keep it under 500');
  });

  it('warns on keys neither tool reads, but not on Claude keys under Codex', () => {
    expect(messages('---\nname: good-skill\ndescription: ok\nsparkle: 1\n---\nbody')).toEqual([
      'warning: unknown frontmatter key `sparkle` — neither tool reads it',
    ]);
    expect(
      messages(
        '---\nname: good-skill\ndescription: ok\nmodel: inherit\n---\nbody',
        undefined,
        'codex',
      ),
    ).toEqual([]);
  });
});

describe('agent rules', () => {
  it('passes a valid agent', () => {
    expect(
      agentMessages(
        '---\nname: reviewer\ndescription: Reviews code.\n---\nYou review.\n',
        'reviewer',
      ),
    ).toEqual([]);
  });

  it('validates name format and filename match', () => {
    const report = agentMessages('---\nname: Bad:Name\ndescription: ok\n---\nx', 'other');
    expect(report).toContain(
      'error: name `Bad:Name` must be lowercase alphanumeric with hyphens (no colons)',
    );
    expect(report).toContain('error: name `Bad:Name` must match its filename `other.md`');
  });

  it('requires a non-empty description', () => {
    expect(agentMessages('---\nname: reviewer\ndescription: " "\n---\nx')).toContain(
      'error: description must not be empty',
    );
  });

  it('warns on keys Claude Code does not read', () => {
    expect(agentMessages('---\nname: reviewer\ndescription: ok\ncodex: {}\n---\nx')).toEqual([
      'warning: unknown frontmatter key `codex` — Claude Code ignores it',
    ]);
  });

  it('warns about inline mcpServers keys and unknown fields', () => {
    const report = agentMessages(
      '---\nname: reviewer\ndescription: ok\nmcpServers:\n  - a:\n      command: x\n    b:\n      command: y\n  - c:\n      type: http\n      url: https://x\n      mystery: 1\n  - plain\n---\nx',
    ).join('\n');
    expect(report).toContain('mcpServers[0] has 2 keys');
    expect(report).toContain('mcpServers[1] server `c` has unknown field `mystery`');
  });

  it('warns, rather than errors, when Claude Code would drop an mcpServers item', () => {
    const report = agentMessages(
      '---\nname: reviewer\ndescription: ok\nmcpServers:\n  - a:\n      type: http\n  - b:\n      type: mystery\n  - 5\n  - c:\n      type: claudeai-proxy\n      url: x\n      id: y\n---\nx',
    );
    const text = report.join('\n');
    expect(report.some((line) => line.startsWith('error:'))).toBe(false);
    expect(text).toContain('warning: mcpServers[0] a.url:');
    expect(text).toContain('warning: mcpServers[1] b.type: unknown type `mystery`');
    expect(text).toContain('warning: mcpServers[2] expected a server name');
    expect(text).toContain('mcpServers[3] c.type: `claudeai-proxy` is a claude.ai connector');
    expect(text).toContain('drops this item, and still loads the agent');
  });
});

describe('frontmatter hooks', () => {
  it('accepts typed skill and agent hooks', () => {
    const hooks =
      '  PostToolUse:\n    - matcher: Edit\n      hooks:\n        - type: command\n          command: ./format.sh\n          once: true';
    expect(messages(skillHooks(hooks))).toEqual([]);
    expect(agentMessages(agentHooks(hooks))).toEqual([]);
  });

  it('rejects unknown events and malformed handlers', () => {
    expect(
      messages(
        skillHooks('  OnSneeze:\n    - hooks:\n        - type: command\n          command: x'),
      )[0],
    ).toContain('error: invalid frontmatter — hooks.OnSneeze');
    expect(agentMessages(agentHooks('  Stop:\n    - hooks:\n        - type: http'))[0]).toContain(
      'error: invalid frontmatter — hooks.Stop.0.hooks.0.url',
    );
  });

  it('warns about hook fields Claude Code ignores, only for the Claude target', () => {
    const hooks =
      '  Stop:\n    - hooks:\n        - type: command\n          command: x\n          comand: y';
    const warning =
      'warning: unknown hook field `hooks.Stop[0].hooks[0].comand` — Claude Code ignores it';
    expect(messages(skillHooks(hooks))).toEqual([warning]);
    expect(agentMessages(agentHooks(hooks))).toEqual([warning]);
    expect(messages(skillHooks(hooks), undefined, 'codex')).toEqual([]);
  });
});

describe('names Windows reserves', () => {
  it('warns that a skill or agent named like a Windows device cannot be created there', () => {
    expect(messages('---\nname: con\ndescription: Does a thing.\n---\n\nBody.\n')).toContain(
      'warning: name `con` is reserved on Windows, so this skill cannot be installed there',
    );
    expect(
      agentMessages('---\nname: com1\ndescription: Reviews diffs.\n---\n\nYou review.\n'),
    ).toContain(
      'warning: name `com1` is reserved on Windows, so this agent cannot be installed there',
    );
  });
});
