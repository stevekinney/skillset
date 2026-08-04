import { GENERATED_MARKER } from './emit.js';
import type { Target } from './frontmatter.js';
import type { Issue } from './doctor.js';
import { renderConditionals } from './template.js';

/**
 * Compile the instructions.md source for one target. Instructions are plain
 * markdown — Claude Code reads the output as CLAUDE.md, Codex as AGENTS.md —
 * so only the `#if` directives are processed; no skill-style fallbacks apply
 * (CLAUDE.md has no inline-shell or argument semantics to translate).
 *
 * @throws {Error} If the body has structural template errors.
 */
export function emitInstructions(raw: string, target: Target): string {
  const rendered = renderConditionals(raw, target);
  if (rendered.errors.length > 0) {
    throw new Error(`template errors: ${rendered.errors.map((error) => error.message).join('; ')}`);
  }

  return `${GENERATED_MARKER}\n\n${rendered.body.replace(/^\n+/, '')}`;
}

const IMPORT_PATTERN = /^@\S+/;

/** Doctor checks for instructions.md. */
export function checkInstructions(raw: string): Issue[] {
  const issues: Issue[] = [];

  const structural = renderConditionals(raw, 'claude');
  for (const templateError of structural.errors) {
    issues.push({
      severity: 'error',
      message: `line ${templateError.line}: ${templateError.message}`,
    });
  }
  if (structural.errors.length > 0) return issues;

  const codexBody = renderConditionals(raw, 'codex').body;
  for (const line of codexBody.split('\n')) {
    if (IMPORT_PATTERN.test(line.trim())) {
      issues.push({
        severity: 'warning',
        message: `\`${line.trim().split(/\s/)[0]}\` looks like a Claude memory import — Codex's AGENTS.md has no import syntax; guard it with \`#if claude\``,
      });
    }
  }

  return issues;
}
