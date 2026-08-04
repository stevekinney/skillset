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
