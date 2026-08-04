import { describe, expect, it } from 'bun:test';

import {
  claudeFrontmatter,
  codexFrontmatter,
  openaiConfiguration,
  parseSkillFile,
  serializeFrontmatter,
  serializeOpenaiConfiguration,
} from './frontmatter.js';

const full = `---
name: my-skill
description: Does a thing.
license: MIT
compatibility: needs git
metadata:
  team: platform
allowed-tools: Read, Grep
when_to_use: When the thing needs doing.
argument-hint: "[issue]"
arguments: issue reason
disable-model-invocation: true
user-invocable: false
disallowed-tools: Write
model: sonnet
effort: medium
context: fork
agent: Explore
background: false
hooks:
  PostToolUse: []
paths: "src/**"
shell: bash
openai:
  interface:
    display_name: My Skill
    short_description: Short.
    icon_small: ./assets/icon.svg
    icon_large: ./assets/icon.png
    brand_color: "#3B82F6"
    default_prompt: Use wisely.
  dependencies:
    tools:
      - type: mcp
        value: server
        description: A server.
        transport: streamable_http
        url: https://example.com
---

Body text.
`;

describe('parseSkillFile', () => {
  it('parses the full union frontmatter and the body', () => {
    const parsed = parseSkillFile(full);
    expect(parsed.frontmatter.name).toBe('my-skill');
    expect(parsed.frontmatter.model).toBe('sonnet');
    expect(parsed.frontmatter.openai?.interface?.display_name).toBe('My Skill');
    expect(parsed.unknownKeys).toEqual([]);
    expect(parsed.body).toBe('\nBody text.\n');
  });

  it('collects unknown top-level keys', () => {
    const parsed = parseSkillFile('---\nname: a\ndescription: b\nmystery: true\n---\nbody');
    expect(parsed.unknownKeys).toEqual(['mystery']);
  });

  it('rejects a file without frontmatter', () => {
    expect(() => parseSkillFile('just a body')).toThrow('missing YAML frontmatter');
  });

  it('rejects frontmatter that is not a mapping', () => {
    expect(() => parseSkillFile('---\n- a\n- b\n---\nbody')).toThrow('YAML mapping');
  });

  it('rejects frontmatter that fails the schema', () => {
    expect(() =>
      parseSkillFile('---\nname: a\ndescription: b\neffort: extreme\n---\nbody'),
    ).toThrow();
  });
});

describe('projections', () => {
  it('claudeFrontmatter keeps Claude fields and drops openai', () => {
    const fields = claudeFrontmatter(parseSkillFile(full).frontmatter);
    expect(fields['model']).toBe('sonnet');
    expect(fields['when_to_use']).toBe('When the thing needs doing.');
    expect(fields['openai']).toBeUndefined();
  });

  it('codexFrontmatter keeps only shared fields', () => {
    const fields = codexFrontmatter(parseSkillFile(full).frontmatter);
    expect(Object.keys(fields).toSorted()).toEqual([
      'allowed-tools',
      'arguments',
      'compatibility',
      'description',
      'license',
      'metadata',
      'name',
    ]);
  });
});

describe('openaiConfiguration', () => {
  it('returns undefined when there is nothing to emit', () => {
    const parsed = parseSkillFile('---\nname: a\ndescription: b\n---\nbody');
    expect(openaiConfiguration(parsed.frontmatter)).toBeUndefined();
  });

  it('maps disable-model-invocation to allow_implicit_invocation: false', () => {
    const parsed = parseSkillFile(
      '---\nname: a\ndescription: b\ndisable-model-invocation: true\n---\nbody',
    );
    expect(openaiConfiguration(parsed.frontmatter)).toEqual({
      policy: { allow_implicit_invocation: false },
    });
  });

  it('lets an explicit openai.policy win over the auto-mapping', () => {
    const parsed = parseSkillFile(
      '---\nname: a\ndescription: b\ndisable-model-invocation: true\nopenai:\n  policy:\n    allow_implicit_invocation: true\n---\nbody',
    );
    expect(openaiConfiguration(parsed.frontmatter)?.policy).toEqual({
      allow_implicit_invocation: true,
    });
  });

  it('passes interface and dependencies through', () => {
    const configuration = openaiConfiguration(parseSkillFile(full).frontmatter);
    expect(configuration?.interface?.brand_color).toBe('#3B82F6');
    expect(configuration?.dependencies?.tools?.[0]?.value).toBe('server');
    expect(configuration?.policy).toEqual({ allow_implicit_invocation: false });
  });
});

describe('serialization', () => {
  it('serializes frontmatter as a fenced YAML block', () => {
    expect(serializeFrontmatter({ name: 'a', description: 'b' })).toBe(
      '---\nname: a\ndescription: b\n---\n',
    );
  });

  it('serializes an openai configuration as YAML', () => {
    expect(serializeOpenaiConfiguration({ policy: { allow_implicit_invocation: false } })).toBe(
      'policy:\n  allow_implicit_invocation: false\n',
    );
  });
});
