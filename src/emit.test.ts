import { describe, expect, it } from 'bun:test';

import { emitSkill, GENERATED_MARKER } from './emit.js';
import { parseSkillFile } from './frontmatter.js';

const source = `---
name: demo
description: A demo.
model: sonnet
disable-model-invocation: true
arguments: issue
openai:
  interface:
    display_name: Demo
---

<!-- #if claude -->
- Repo: !\`git rev-parse HEAD\`
<!-- #else -->
- Run \`git rev-parse HEAD\` yourself.
<!-- #endif -->

Fix $issue.
`;

describe('emitSkill', () => {
  it('emits Claude output with Claude fields and the raw dynamic body', () => {
    const [skillFile, ...rest] = emitSkill(parseSkillFile(source), 'claude');
    expect(rest).toEqual([]);
    expect(skillFile?.relativePath).toBe('SKILL.md');
    expect(skillFile?.contents).toContain('model: sonnet');
    expect(skillFile?.contents).not.toContain('openai:');
    expect(skillFile?.contents).toContain(GENERATED_MARKER);
    expect(skillFile?.contents).toContain('- Repo: !`git rev-parse HEAD`');
    expect(skillFile?.contents).toContain('Fix $issue.');
    expect(skillFile?.contents).not.toContain('#if');
    expect(skillFile?.contents).not.toContain('git rev-parse HEAD` yourself');
  });

  it('emits Codex output with shared fields, fallbacks, and openai.yaml', () => {
    const files = emitSkill(parseSkillFile(source), 'codex');
    const skillFile = files.find((file) => file.relativePath === 'SKILL.md');
    const openaiFile = files.find((file) => file.relativePath === 'agents/openai.yaml');

    expect(skillFile?.contents).toContain('name: demo');
    expect(skillFile?.contents).not.toContain('model:');
    expect(skillFile?.contents).toContain(GENERATED_MARKER);
    expect(skillFile?.contents).toContain('Run `git rev-parse HEAD` yourself.');
    expect(skillFile?.contents).not.toContain('!`');
    expect(skillFile?.contents).toContain('the user-provided "issue" value');

    expect(openaiFile?.contents).toContain('display_name: Demo');
    expect(openaiFile?.contents).toContain('allow_implicit_invocation: false');
  });

  it('omits openai.yaml when there is no Codex configuration', () => {
    const files = emitSkill(parseSkillFile('---\nname: a\ndescription: b\n---\nbody'), 'codex');
    expect(files.map((file) => file.relativePath)).toEqual(['SKILL.md']);
  });

  it('throws on structural template errors', () => {
    const parsed = parseSkillFile('---\nname: a\ndescription: b\n---\n<!-- #if claude -->\nx');
    expect(() => emitSkill(parsed, 'claude')).toThrow('template errors');
  });
});
