import type { Target } from './frontmatter.js';

/** A structural problem in a skill body's conditional directives. */
export type TemplateError = {
  /** 1-based line number of the offending directive (or last line for unclosed blocks). */
  line: number;
  message: string;
};

const DIRECTIVE_PATTERN = /^\s*<!--\s*#(\S+)([^>]*?)-->\s*$/;

type Directive =
  | { kind: 'if'; target?: Target; error?: string }
  | { kind: 'else' }
  | { kind: 'endif' }
  | { kind: 'invalid'; message: string };

function parseDirective(line: string): Directive | undefined {
  const match = DIRECTIVE_PATTERN.exec(line);
  if (!match) return undefined;

  const keyword = match[1]!;
  const argument = match[2]!.trim();

  if (keyword === 'if') {
    if (argument === 'claude' || argument === 'codex') return { kind: 'if', target: argument };
    // Still open a block so the matching #endif doesn't cascade a second error.
    return { kind: 'if', error: `#if expects \`claude\` or \`codex\`, got \`${argument}\`` };
  }

  if (keyword === 'else') {
    if (argument === '') return { kind: 'else' };
    return { kind: 'invalid', message: '#else takes no argument' };
  }

  if (keyword === 'endif') {
    if (argument === '') return { kind: 'endif' };
    return { kind: 'invalid', message: '#endif takes no argument' };
  }

  return { kind: 'invalid', message: `unknown directive \`#${keyword}\`` };
}

/** The outcome of rendering a body's conditionals for one target. */
export type RenderResult = {
  /** The body with directive lines removed and excluded blocks dropped. */
  body: string;
  /** Structural errors; when non-empty, `body` is unreliable and must not be emitted. */
  errors: TemplateError[];
};

type Frame = { keeping: boolean; sawElse: boolean; line: number };

/**
 * Render `<!-- #if claude/codex -->` / `<!-- #else -->` / `<!-- #endif -->`
 * blocks for one target. Directive lines are removed from the output; blocks
 * for the other target are dropped wholesale. Nesting is supported.
 *
 * Structural errors (unbalanced or malformed directives) are collected rather
 * than thrown so `doctor` can report all of them at once; they are
 * target-independent.
 */
export function renderConditionals(body: string, target: Target): RenderResult {
  const lines = body.split('\n');
  const output: string[] = [];
  const errors: TemplateError[] = [];
  const stack: Frame[] = [];

  const applyDirective = (directive: Directive, lineNumber: number): void => {
    if (directive.kind === 'invalid') {
      errors.push({ line: lineNumber, message: directive.message });
      return;
    }

    if (directive.kind === 'if') {
      if (directive.error) errors.push({ line: lineNumber, message: directive.error });
      stack.push({ keeping: directive.target === target, sawElse: false, line: lineNumber });
      return;
    }

    const frame = stack.at(-1);
    if (!frame) {
      errors.push({ line: lineNumber, message: `#${directive.kind} without a matching #if` });
      return;
    }

    if (directive.kind === 'endif') {
      stack.pop();
      return;
    }

    if (frame.sawElse) {
      errors.push({ line: lineNumber, message: 'duplicate #else in the same #if block' });
      return;
    }

    frame.sawElse = true;
    frame.keeping = !frame.keeping;
  };

  for (const [index, line] of lines.entries()) {
    const directive = parseDirective(line);

    if (directive) {
      applyDirective(directive, index + 1);
    } else if (stack.every((frame) => frame.keeping)) {
      output.push(line);
    }
  }

  for (const frame of stack) {
    errors.push({ line: frame.line, message: '#if without a matching #endif' });
  }

  return { body: output.join('\n'), errors };
}
