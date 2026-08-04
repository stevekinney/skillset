import { describe, expect, it } from 'bun:test';

import {
  applyCodexFallbacks,
  argumentNames,
  rewriteArguments,
  rewriteEnvironmentSubstitutions,
  rewriteInlineShell,
} from './fallback.js';

describe('rewriteInlineShell', () => {
  it('leaves bodies without inline shell untouched', () => {
    const result = rewriteInlineShell('plain `code` text');
    expect(result.body).toBe('plain `code` text');
    expect(result.changed).toBe(false);
  });

  it('rewrites inline tokens and prepends the note', () => {
    const result = rewriteInlineShell('- Repo: !`git rev-parse --show-toplevel`');
    expect(result.changed).toBe(true);
    expect(result.body).toContain('> Some values below reference shell commands');
    expect(result.body).toContain('- Repo: `git rev-parse --show-toplevel`');
    expect(result.body).not.toContain('!`');
  });

  it('only rewrites tokens at line start or after whitespace', () => {
    const result = rewriteInlineShell('KEY=!`date`');
    expect(result.changed).toBe(false);
    expect(result.body).toBe('KEY=!`date`');
  });

  it('rewrites shell fences into bash fences with a run instruction', () => {
    const result = rewriteInlineShell('```!\ngit status\n```');
    expect(result.body).toContain('Run the following and use its output:\n\n```bash');
    expect(result.body).toContain('git status');
  });

  it('preserves indentation on rewritten fences', () => {
    const result = rewriteInlineShell('  ```!\n  git status\n  ```');
    expect(result.body).toContain('  Run the following and use its output:\n\n  ```bash');
  });
});

describe('argumentNames', () => {
  it('returns an empty list when undeclared', () => {
    expect(argumentNames(undefined)).toEqual([]);
  });

  it('accepts a YAML list', () => {
    expect(argumentNames(['issue', 'reason'])).toEqual(['issue', 'reason']);
  });

  it('splits a space-separated string', () => {
    expect(argumentNames('  issue   reason ')).toEqual(['issue', 'reason']);
  });
});

describe('rewriteArguments', () => {
  it('replaces $ARGUMENTS with prose', () => {
    const result = rewriteArguments('Act on $ARGUMENTS.', []);
    expect(result.body).toBe('Act on the arguments the user provided.');
    expect(result.changed).toBe(true);
  });

  it('replaces $N and $ARGUMENTS[N] with one-based prose', () => {
    const result = rewriteArguments('First: $0. Third: $ARGUMENTS[2].', []);
    expect(result.body).toBe('First: argument 1 from the user. Third: argument 3 from the user.');
  });

  it('replaces declared named arguments only', () => {
    const result = rewriteArguments('Fix $issue but not $mystery.', ['issue']);
    expect(result.body).toBe('Fix the user-provided "issue" value but not $mystery.');
  });

  it('unescapes \\$ into a literal dollar', () => {
    const result = rewriteArguments('Costs \\$1 and \\$ARGUMENTS stays.', []);
    expect(result.body).toBe('Costs $1 and $ARGUMENTS stays.');
    expect(result.changed).toBe(false);
  });
});

describe('rewriteEnvironmentSubstitutions', () => {
  it('replaces the directory variables with prose', () => {
    const result = rewriteEnvironmentSubstitutions(
      'Run ${CLAUDE_SKILL_DIR}/x from ${CLAUDE_PROJECT_DIR}.',
    );
    expect(result.body).toBe("Run this skill's directory/x from the project root.");
    expect(result.dropped).toEqual([]);
  });

  it('drops the session and effort variables and reports them', () => {
    const result = rewriteEnvironmentSubstitutions('id ${CLAUDE_SESSION_ID} at ${CLAUDE_EFFORT}');
    expect(result.body).toBe('id  at ');
    expect(result.dropped).toEqual(['${CLAUDE_SESSION_ID}', '${CLAUDE_EFFORT}']);
  });

  it('leaves unknown CLAUDE_* tokens alone', () => {
    const result = rewriteEnvironmentSubstitutions('${CLAUDE_UNKNOWN} stays');
    expect(result.body).toBe('${CLAUDE_UNKNOWN} stays');
    expect(result.changed).toBe(false);
  });
});

describe('applyCodexFallbacks', () => {
  it('runs all three passes and merges their outcomes', () => {
    const body =
      '- Repo: !`git rev-parse HEAD`\n- Fix $issue in ${CLAUDE_SKILL_DIR} (${CLAUDE_EFFORT})';
    const result = applyCodexFallbacks(body, ['issue']);
    expect(result.changed).toBe(true);
    expect(result.body).toContain('`git rev-parse HEAD`');
    expect(result.body).toContain('the user-provided "issue" value');
    expect(result.body).toContain("this skill's directory");
    expect(result.dropped).toEqual(['${CLAUDE_EFFORT}']);
  });

  it('reports no change for a static body', () => {
    const result = applyCodexFallbacks('static text', []);
    expect(result).toEqual({ body: 'static text', changed: false, dropped: [] });
  });
});
