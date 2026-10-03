import { describe, expect, it } from 'bun:test';

import { parseAgentFile } from './agent-frontmatter.js';

const frontmatterWith = (extra: string): string =>
  `---\nname: a\ndescription: b\n${extra}\n---\nbody`;

describe('agent codex hooks, skills, and tools tables', () => {
  it('types codex.hooks, codex.skills, and codex.tools', () => {
    const parsed = parseAgentFile(
      frontmatterWith(
        [
          'codex:',
          '  hooks:',
          '    PreToolUse:',
          '      - matcher: Bash',
          '        hooks:',
          '          - type: command',
          '            command: ./check.sh',
          '  skills:',
          '    config:',
          '      - name: noisy',
          '        enabled: false',
          '  tools:',
          '    update_plan:',
          '      enabled: true',
        ].join('\n'),
      ),
    );
    expect(parsed.frontmatter.codex?.hooks).toMatchObject({ PreToolUse: [{ matcher: 'Bash' }] });
    expect(parsed.frontmatter.codex?.skills?.config?.[0]?.enabled).toBe(false);
    expect(parsed.frontmatter.codex?.tools?.update_plan?.enabled).toBe(true);
  });

  it('rejects malformed codex.hooks, codex.skills, and codex.tools', () => {
    for (const block of [
      'codex:\n  hooks:\n    Stop:\n      - hooks:\n          - type: command',
      'codex:\n  hooks:\n    Stop: nope',
      'codex:\n  skills:\n    config:\n      - name: a',
      'codex:\n  tools: [Read, Grep]',
    ]) {
      expect(() => parseAgentFile(frontmatterWith(block))).toThrow();
    }
  });
});
