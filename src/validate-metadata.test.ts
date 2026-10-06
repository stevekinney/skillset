import { describe, expect, it } from 'bun:test';

import { validateSkillMetadata, validateSubagentMetadata } from './validate-metadata.js';

function skill(frontmatter: string, body = 'Do the thing.\n'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function messages(result: { issues: { message: string }[] }): string[] {
  return result.issues.map((issue) => issue.message);
}

describe('validateSkillMetadata', () => {
  it('accepts a well-formed skill and returns its frontmatter and body', () => {
    const result = validateSkillMetadata(
      skill('name: pdf-extractor\ndescription: Extracts text from PDFs.'),
      { directoryName: 'pdf-extractor' },
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.frontmatter?.name).toBe('pdf-extractor');
    expect(result.body).toBe('Do the thing.\n');
  });

  it('strips a byte-order mark', () => {
    const result = validateSkillMetadata(`﻿${skill('name: a-skill\ndescription: Does a thing.')}`);

    expect(result.valid).toBe(true);
  });

  it('reports a file with no frontmatter', () => {
    const result = validateSkillMetadata('# Just markdown\n');

    expect(result.valid).toBe(false);
    expect(messages(result)).toEqual(['missing YAML frontmatter (expected a leading `---` block)']);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe('');
  });

  it('reports malformed YAML', () => {
    const result = validateSkillMetadata(skill('name: [unterminated'));

    expect(result.valid).toBe(false);
    expect(messages(result)[0]).toStartWith('invalid frontmatter —');
  });

  it('refuses executable frontmatter instead of running it', () => {
    const result = validateSkillMetadata('---js\n{ name: "x" }\n---\nbody\n');

    expect(result.valid).toBe(false);
    expect(messages(result)).toEqual([
      'invalid frontmatter — executable frontmatter is not allowed — use YAML',
    ]);
  });

  it('reports frontmatter that is not a mapping', () => {
    const result = validateSkillMetadata('---\n- one\n- two\n---\nbody\n');

    expect(result.valid).toBe(false);
    expect(messages(result)).toEqual(['frontmatter must be a YAML mapping']);
  });

  it('reports schema failures with the failing path', () => {
    const result = validateSkillMetadata(skill('name: a-skill\ndescription: 7'));

    expect(result.valid).toBe(false);
    expect(messages(result)[0]).toStartWith('invalid frontmatter — description:');
    expect(result.body).toBe('Do the thing.\n');
  });

  it('runs the doctor rules, including the directory match', () => {
    const result = validateSkillMetadata(skill('name: Wrong_Name\ndescription: Does a thing.'), {
      directoryName: 'other',
    });

    expect(result.valid).toBe(false);
    expect(messages(result)).toContain(
      'name `Wrong_Name` must be lowercase alphanumeric with single hyphens between words',
    );
    expect(messages(result)).toContain('name `Wrong_Name` must match its directory name `other`');
  });

  it('skips the directory match when no directory is given', () => {
    const result = validateSkillMetadata(skill('name: a-skill\ndescription: Does a thing.'));

    expect(result.issues).toEqual([]);
  });

  it('warns about anti-patterns without failing', () => {
    const result = validateSkillMetadata(
      skill(
        [
          'name: helper',
          'description: I help with things.',
          'metadata:',
          '  version: "1"',
          '  count: 3',
          'disable-model-invocation: true',
          'user-invocable: false',
          'agent: reviewer',
        ].join('\n'),
        '',
      ),
    );

    expect(result.valid).toBe(true);
    expect(messages(result)).toEqual([
      'name `helper` is vague — name the skill for what it does',
      'description should be written in the third person ("Extracts text from PDFs"), not as "I", "we", or "you"',
      'metadata.count should be a string — the agentskills.io spec maps strings to strings',
      '`disable-model-invocation: true` with `user-invocable: false` leaves nothing able to invoke the skill',
      '`agent` only applies with `context: fork` — it is ignored here',
      'the skill body is empty — add the instructions Claude should follow',
    ]);
  });

  it('does not warn about agent with context fork', () => {
    const result = validateSkillMetadata(
      skill('name: a-skill\ndescription: Does a thing.\nagent: reviewer\ncontext: fork'),
    );

    expect(result.issues).toEqual([]);
  });

  it('flags an over-long compatibility and a truncated listing', () => {
    const result = validateSkillMetadata(
      skill(
        `name: a-skill\ndescription: ${'a'.repeat(1000)}\nwhen_to_use: ${'b'.repeat(600)}\ncompatibility: ${'c'.repeat(501)}`,
      ),
    );

    expect(result.valid).toBe(false);
    expect(messages(result)).toContain('compatibility exceeds 500 characters');
    expect(messages(result).join('\n')).toContain('truncates them in the skill listing');
  });

  it('warns when gray-matter and the compiler read a value differently', () => {
    const result = validateSkillMetadata(
      skill('name: a-skill\ndescription: Does a thing.\nmetadata:\n  released: 2024-01-01'),
    );

    expect(result.valid).toBe(true);
    expect(messages(result)).toContain(
      'gray-matter and the compiler read this frontmatter differently (an unquoted date or a number with a leading zero) — quote the value so every tool reads the same thing',
    );
  });

  it('warns when the compiler cannot parse a block gray-matter accepts', () => {
    const result = validateSkillMetadata(
      skill('name: a-skill\ndescription: Does a thing.\nmetadata: {a: "1",\n\tb: "2"}'),
    );

    expect(result.valid).toBe(true);
    expect(messages(result)).toEqual([
      expect.stringMatching(
        /^gray-matter reads this frontmatter but the compiler's YAML parser does not — /,
      ),
    ]);
  });
});

describe('validateSubagentMetadata', () => {
  const body = 'You review code.\n';

  it('accepts a well-formed agent', () => {
    const result = validateSubagentMetadata(
      skill('name: code-reviewer\ndescription: Reviews code. Use after edits.', body),
      { fileName: 'code-reviewer' },
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.frontmatter?.name).toBe('code-reviewer');
    expect(result.body).toBe(body);
  });

  it('reports a missing fence and schema failures', () => {
    expect(validateSubagentMetadata('no frontmatter').valid).toBe(false);

    const result = validateSubagentMetadata(skill('name: a-agent\ndescription: x\nmaxTurns: -1'));
    expect(result.valid).toBe(false);
    expect(messages(result)[0]).toStartWith('invalid frontmatter — maxTurns:');
  });

  it('runs the doctor rules, including the filename match', () => {
    const result = validateSubagentMetadata(
      skill('name: reviewer\ndescription: Reviews code.', body),
      { fileName: 'other' },
    );

    expect(result.valid).toBe(false);
    expect(messages(result)).toEqual(['name `reviewer` must match its filename `other.md`']);
  });

  it('warns about anti-patterns without failing', () => {
    const result = validateSubagentMetadata(
      skill(
        'name: reviewer\ndescription: Reviews code.\npermissionMode: bypassPermissions\ntools: Read, Bash\ndisallowedTools:\n  - Bash',
        '',
      ),
    );

    expect(result.valid).toBe(true);
    expect(messages(result)).toEqual([
      "the agent body is empty — it is the agent's system prompt",
      '`permissionMode: bypassPermissions` skips every permission prompt for this agent',
      '`Bash` is in both `tools` and `disallowedTools`',
      expect.stringContaining('`tools` is folded into the Codex developer instructions'),
      expect.stringContaining('`disallowedTools` is folded into the Codex developer instructions'),
      'permissionMode `bypassPermissions` has no Codex sandbox_mode mapping — set `codex.sandbox_mode` explicitly',
    ]);
  });

  it('accepts tools given as a list', () => {
    const result = validateSubagentMetadata(
      skill('name: reviewer\ndescription: Reviews code.\ntools:\n  - Read\n  - Grep', body),
    );

    expect(messages(result).join('\n')).not.toContain('both `tools`');
  });
});
