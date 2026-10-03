import { describe, expect, it } from 'bun:test';

import type { SourceAgent } from './discover.js';
import { checkAgent } from './doctor.js';

function agent(raw: string, name = 'reviewer'): SourceAgent {
  return { name, path: `/agents/${name}.md`, raw };
}

function agentMessages(source: SourceAgent): string[] {
  return checkAgent(source).issues.map((issue) => `${issue.severity}: ${issue.message}`);
}

describe('Codex agent tables', () => {
  const withCodex = (block: string) =>
    agentMessages(agent(`---\nname: reviewer\ndescription: ok\ncodex:\n${block}\n---\nx`));

  it('warns that codex.hooks is validated but not applied and flags what Codex ignores', () => {
    const report = withCodex(
      [
        '  hooks:',
        '    Sneeze: []',
        '    Stop:',
        '      - colour: red',
        '        hooks:',
        '          - type: command',
        '            command: x',
        '            if: y',
        '          - type: mystery',
        '          - type: prompt',
        '            prompt: p',
      ].join('\n'),
    ).join('\n');
    expect(report).toContain('`codex.hooks` is validated but not applied');
    expect(report).toContain('codex.hooks.Sneeze is unknown');
    expect(report).toContain('codex.hooks.Stop[0].colour is unknown');
    expect(report).toContain('codex.hooks.Stop[0].hooks[0].if is unknown');
    expect(report).toContain('codex.hooks.Stop[0].hooks[1] has an unrecognised handler type');
    expect(report).toContain('codex.hooks.Stop[0].hooks[2] is a `prompt` or `agent` handler');
  });

  it('reports unknown skills fields, ambiguous selectors, and ineffective settings', () => {
    const report = withCodex(
      '  skills:\n    extra: 1\n    config:\n      - name: a\n        path: b\n        enabled: true',
    ).join('\n');
    expect(report).toContain('codex.skills.extra is unknown');
    expect(report).toContain('codex.skills.config[0] should set exactly one of `path` or `name`');
    expect(report).toContain('`codex.skills` has no effect');

    const effective = withCodex('  skills:\n    config:\n      - name: a\n        enabled: false');
    expect(effective.join('\n')).not.toContain('has no effect');
  });

  it('warns that codex.tools is not applied and flags unknown fields', () => {
    const report = withCodex(
      '  tools:\n    mystery: 1\n    update_plan:\n      enabled: true',
    ).join('\n');
    expect(report).toContain('`codex.tools` is validated but not applied');
    expect(report).toContain('has no per-agent tool allowlist');
    expect(report).toContain('codex.tools.mystery is unknown');
  });

  it('rejects a codex.tools allowlist array as a frontmatter error', () => {
    expect(withCodex('  tools: [Read]')[0]).toContain('error: invalid frontmatter');
  });
});
