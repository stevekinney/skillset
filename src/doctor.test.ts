import { describe, expect, it } from 'bun:test';

import type { SourceAgent, SourceSkill } from './discover.js';
import { checkAgent, checkAgents, checkSkill, checkSkills, hasErrors } from './doctor.js';

function skill(raw: string, name = 'good-skill'): SourceSkill {
  return { name, directory: `/skills/${name}`, raw, supportingFiles: [] };
}

function messages(source: SourceSkill): string[] {
  return checkSkill(source).issues.map((issue) => `${issue.severity}: ${issue.message}`);
}

const valid = '---\nname: good-skill\ndescription: Does a thing.\n---\n\nBody.\n';

describe('checkSkill', () => {
  it('passes a valid skill with no issues', () => {
    const report = checkSkill(skill(valid));
    expect(report.issues).toEqual([]);
    expect(report.parsed?.frontmatter.name).toBe('good-skill');
  });

  it('reports missing frontmatter as an error', () => {
    expect(messages(skill('no frontmatter'))[0]).toContain('error: invalid frontmatter');
  });

  it('reports malformed YAML as an error', () => {
    expect(messages(skill('---\nname: [unclosed\n---\nbody'))[0]).toContain(
      'error: invalid frontmatter',
    );
  });

  it('reports schema violations with their field paths', () => {
    const report = messages(skill('---\nname: good-skill\ndescription: ok\nmodel: [a]\n---\nbody'));
    expect(report[0]).toContain('model');
  });

  it('validates the name format, length, and directory match', () => {
    const badFormat = messages(
      skill('---\nname: Bad_Name\ndescription: ok\n---\nbody', 'bad-name'),
    );
    expect(badFormat.some((message) => message.includes('lowercase alphanumeric'))).toBe(true);
    expect(badFormat.some((message) => message.includes('must match its directory'))).toBe(true);

    const longName = `x${'y'.repeat(70)}`;
    const tooLong = messages(skill(`---\nname: ${longName}\ndescription: ok\n---\nbody`, longName));
    expect(tooLong.some((message) => message.includes('exceeds 64 characters'))).toBe(true);
  });

  it('warns on reserved words in the name', () => {
    const report = messages(
      skill('---\nname: claude-helper\ndescription: ok\n---\nbody', 'claude-helper'),
    );
    expect(report).toEqual([
      "warning: name contains reserved word `claude` — Claude's platform rejects it",
    ]);
  });

  it('validates the description', () => {
    expect(
      messages(skill('---\nname: good-skill\ndescription: " "\n---\nbody')).some((message) =>
        message.includes('must not be empty'),
      ),
    ).toBe(true);
    expect(
      messages(skill(`---\nname: good-skill\ndescription: ${'x'.repeat(1100)}\n---\nbody`)).some(
        (message) => message.includes('exceeds 1024'),
      ),
    ).toBe(true);
    expect(
      messages(skill('---\nname: good-skill\ndescription: "uses <tags>"\n---\nbody')).some(
        (message) => message.includes('XML tags'),
      ),
    ).toBe(true);
  });

  it('warns when SKILL.md exceeds 500 lines', () => {
    const body = Array.from({ length: 510 }, () => 'line').join('\n');
    const report = messages(skill(`${valid}${body}`));
    expect(report.some((message) => message.includes('keep it under 500'))).toBe(true);
  });

  it('warns on unknown frontmatter keys', () => {
    const report = messages(skill('---\nname: good-skill\ndescription: ok\nmystery: 1\n---\nbody'));
    expect(report).toEqual([
      'warning: unknown frontmatter key `mystery` — neither tool understands it',
    ]);
  });

  it('reports template errors with line numbers and skips fallback checks', () => {
    const report = messages(skill(`${valid}<!-- #if claude -->\n!\`date\`\n`));
    expect(report.length).toBe(1);
    expect(report[0]).toContain('error: line');
    expect(report[0]).toContain('#if without a matching #endif');
  });

  it('warns when Claude-only features reach the Codex output unguarded', () => {
    const report = messages(skill(`${valid}\n- Now: !\`date\`\n`));
    expect(report).toEqual([
      'warning: body uses Claude-only dynamic features outside an `#if claude` guard — the Codex output rewrites them as prose; check the translation',
    ]);
  });

  it('does not warn when Claude-only features are guarded', () => {
    const guarded = `${valid}<!-- #if claude -->\n- Now: !\`date\`\n<!-- #endif -->\n`;
    expect(messages(skill(guarded))).toEqual([]);
  });

  it('warns about dropped tokens with no Codex equivalent', () => {
    const report = messages(skill(`${valid}\nSession: \${CLAUDE_SESSION_ID}\n`));
    expect(
      report.some((message) =>
        message.includes('`${CLAUDE_SESSION_ID}` has no Codex equivalent and is dropped'),
      ),
    ).toBe(true);
  });
});

describe('checkSkills and hasErrors', () => {
  it('reports across skills and detects errors', () => {
    const reports = checkSkills([skill(valid), skill('broken', 'broken')]);
    expect(reports.map((report) => report.name)).toEqual(['good-skill', 'broken']);
    expect(hasErrors(reports)).toBe(true);
    expect(hasErrors([reports[0]!])).toBe(false);
  });
});

function agent(raw: string, name = 'reviewer'): SourceAgent {
  return { name, path: `/agents/${name}.md`, raw };
}

function agentMessages(source: SourceAgent): string[] {
  return checkAgent(source).issues.map((issue) => `${issue.severity}: ${issue.message}`);
}

const validAgent = '---\nname: reviewer\ndescription: Reviews diffs.\n---\n\nYou review.\n';

describe('checkAgent', () => {
  it('passes a valid agent', () => {
    const report = checkAgent(agent(validAgent));
    expect(report.issues).toEqual([]);
    expect(report.parsed?.frontmatter.name).toBe('reviewer');
  });

  it('reports parse failures as errors', () => {
    expect(agentMessages(agent('no frontmatter'))[0]).toContain('error: invalid frontmatter');
    expect(
      agentMessages(agent('---\nname: reviewer\ndescription: ok\nmemory: cloud\n---\nx'))[0],
    ).toContain('memory');
  });

  it('validates name format and filename match', () => {
    const report = agentMessages(agent('---\nname: Bad_Name\ndescription: ok\n---\nx', 'bad-name'));
    expect(report.some((message) => message.includes('lowercase alphanumeric'))).toBe(true);
    expect(report.some((message) => message.includes('must match its filename'))).toBe(true);
  });

  it('requires a non-empty description', () => {
    expect(
      agentMessages(agent('---\nname: reviewer\ndescription: " "\n---\nx')).some((message) =>
        message.includes('must not be empty'),
      ),
    ).toBe(true);
  });

  it('warns on unknown keys and unguarded Claude-only body features', () => {
    const report = agentMessages(
      agent('---\nname: reviewer\ndescription: ok\nmystery: 1\n---\nNow: !`date`\n'),
    );
    expect(report.join('\n')).toContain('unknown frontmatter key `mystery`');
    expect(report.join('\n')).toContain('Claude-only dynamic features');
  });

  it('reports template errors and dropped env tokens', () => {
    expect(agentMessages(agent(`${validAgent}<!-- #if claude -->\n`)).join('\n')).toContain(
      '#if without a matching #endif',
    );
    expect(agentMessages(agent(`${validAgent}\${CLAUDE_SESSION_ID}\n`)).join('\n')).toContain(
      'has no Codex equivalent and is dropped',
    );
  });

  it('warns about dropped, manual-translation, and prose-folded fields', () => {
    const report = agentMessages(
      agent(
        '---\nname: reviewer\ndescription: ok\ntools: Read\nmemory: user\nhooks:\n  Stop: []\nmcpServers: [codex]\n---\nx',
      ),
    );
    expect(report.join('\n')).toContain('`memory` has no documented Codex equivalent — dropped');
    expect(report.join('\n')).toContain('`hooks` is not auto-translated');
    expect(report.join('\n')).toContain('set `codex.mcp_servers` explicitly');
    expect(report.join('\n')).toContain('`tools` is folded into the Codex developer instructions');
  });

  it('warns about inline mcpServers keys, unknown fields, and dropped codex.mcp_servers', () => {
    const report = agentMessages(
      agent(
        '---\nname: reviewer\ndescription: ok\nmcpServers:\n  - a:\n      command: x\n    b:\n      command: y\n  - c:\n      type: http\n      url: https://x\n      mystery: 1\n  - plain\ncodex:\n  mcp_servers:\n    docs:\n      url: https://x\n      experimental_environment: remote\n---\nx',
      ),
    ).join('\n');
    expect(report).toContain('mcpServers[0] has 2 keys');
    expect(report).toContain('mcpServers[1] server `c` has unknown field `mystery`');
    expect(report).toContain('codex.mcp_servers.docs has unknown field `experimental_environment`');
    expect(report).toContain('Codex 0.160 renamed it to `environment_id`');
    expect(report).toContain('`codex.mcp_servers` is validated but not applied');
  });

  it('warns, rather than errors, when Claude Code would drop an mcpServers item', () => {
    const report = agentMessages(
      agent(
        '---\nname: reviewer\ndescription: ok\nmcpServers:\n  - a:\n      type: http\n  - b:\n      type: mystery\n  - 5\n  - c:\n      type: claudeai-proxy\n      url: x\n      id: y\n---\nx',
      ),
    );
    const text = report.join('\n');
    expect(report.some((line) => line.startsWith('error:'))).toBe(false);
    expect(text).toContain('warning: mcpServers[0] a.url:');
    expect(text).toContain('warning: mcpServers[1] b.type: unknown type `mystery`');
    expect(text).toContain('warning: mcpServers[2] expected a server name');
    expect(text).toContain('mcpServers[3] c.type: `claudeai-proxy` is a claude.ai connector');
    expect(text).toContain('drops this item, and still loads the agent');
  });

  it('warns about nested unknown fields in codex.mcp_servers', () => {
    const text = agentMessages(
      agent(
        '---\nname: reviewer\ndescription: ok\ncodex:\n  mcp_servers:\n    docs:\n      url: https://x\n      oauth:\n        clientid: a\n---\nx',
      ),
    ).join('\n');
    expect(text).toContain('codex.mcp_servers.docs has unknown field `oauth.clientid`');
    expect(text).toContain('the Codex docs still list the key');
  });

  it('does not warn when the codex counterpart is set explicitly', () => {
    const report = agentMessages(
      agent(
        '---\nname: reviewer\ndescription: ok\nhooks:\n  Stop: []\ncodex:\n  hooks:\n    hooks: {}\n---\nx',
      ),
    );
    expect(report.join('\n')).not.toContain('`hooks` is not auto-translated');
  });

  it('warns when permissionMode has no sandbox_mode mapping', () => {
    const unmapped = agentMessages(
      agent('---\nname: reviewer\ndescription: ok\npermissionMode: dontAsk\n---\nx'),
    );
    expect(unmapped.join('\n')).toContain('has no Codex sandbox_mode mapping');

    const mapped = agentMessages(
      agent('---\nname: reviewer\ndescription: ok\npermissionMode: plan\n---\nx'),
    );
    expect(mapped.join('\n')).not.toContain('sandbox_mode mapping');

    const explicit = agentMessages(
      agent(
        '---\nname: reviewer\ndescription: ok\npermissionMode: dontAsk\ncodex:\n  sandbox_mode: read-only\n---\nx',
      ),
    );
    expect(explicit.join('\n')).not.toContain('sandbox_mode mapping');
  });
});

describe('checkAgents', () => {
  it('reports across agents', () => {
    const reports = checkAgents([agent(validAgent), agent('broken', 'broken')]);
    expect(reports.map((report) => report.name)).toEqual(['reviewer', 'broken']);
    expect(hasErrors(reports)).toBe(true);
  });
});

const skillHooks = (hooks: string): string =>
  `---\nname: good-skill\ndescription: Does a thing.\nhooks:\n${hooks}\n---\n\nBody.\n`;
const agentHooks = (hooks: string): string =>
  `---\nname: reviewer\ndescription: Reviews diffs.\nhooks:\n${hooks}\n---\n\nYou review.\n`;

describe('frontmatter hooks', () => {
  it('accepts typed skill and agent hooks', () => {
    const hooks =
      '  PostToolUse:\n    - matcher: Edit\n      hooks:\n        - type: command\n          command: ./format.sh\n          once: true';
    expect(messages(skill(skillHooks(hooks)))).toEqual([]);
    expect(agentMessages(agent(agentHooks(hooks)))).toContain(
      'warning: `hooks` is not auto-translated — Codex agents support their own `hooks` table with a different schema; set `codex.hooks` explicitly',
    );
  });

  it('rejects unknown events and malformed handlers', () => {
    expect(
      messages(
        skill(
          skillHooks('  OnSneeze:\n    - hooks:\n        - type: command\n          command: x'),
        ),
      )[0],
    ).toContain('error: invalid frontmatter — hooks.OnSneeze');
    expect(
      agentMessages(agent(agentHooks('  Stop:\n    - hooks:\n        - type: http')))[0],
    ).toContain('error: invalid frontmatter — hooks.Stop.0.hooks.0.url');
  });

  it('warns about hook fields Claude Code ignores', () => {
    const hooks =
      '  Stop:\n    - hooks:\n        - type: command\n          command: x\n          comand: y';
    expect(messages(skill(skillHooks(hooks)))).toEqual([
      'warning: unknown hook field `hooks.Stop[0].hooks[0].comand` — Claude Code ignores it',
    ]);
    expect(agentMessages(agent(agentHooks(hooks)))).toContain(
      'warning: unknown hook field `hooks.Stop[0].hooks[0].comand` — Claude Code ignores it',
    );
  });
});

describe('names Windows reserves', () => {
  it('warns that a skill or agent named like a Windows device cannot be created there', () => {
    const reserved = '---\nname: con\ndescription: Does a thing.\n---\n\nBody.\n';
    expect(messages(skill(reserved, 'con'))).toContain(
      'warning: name `con` is reserved on Windows, so this skill cannot be installed there',
    );
    const reservedAgent = '---\nname: com1\ndescription: Reviews diffs.\n---\n\nYou review.\n';
    expect(agentMessages(agent(reservedAgent, 'com1'))).toContain(
      'warning: name `com1` is reserved on Windows, so this agent cannot be installed there',
    );
    expect(messages(skill(valid)).join('\n')).not.toContain('reserved on Windows');
  });
});
