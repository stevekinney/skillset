import { z } from 'zod';

/** One finding about a file. Errors make it invalid; warnings do not. */
export type Issue = {
  severity: 'error' | 'warning';
  message: string;
};

export function error(message: string): Issue {
  return { severity: 'error', message };
}

export function warning(message: string): Issue {
  return { severity: 'warning', message };
}

/** True when any issue has `error` severity. */
export function hasErrors(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

/** Render a parse failure (a `ZodError` or any error) as one readable line. */
export function describeParseFailure(cause: unknown): string {
  if (cause instanceof z.ZodError) {
    return cause.issues
      .map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`)
      .join('; ');
  }

  return cause instanceof Error ? cause.message : String(cause);
}
