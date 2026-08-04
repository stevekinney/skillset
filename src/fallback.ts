/**
 * Rewrites applied to the Codex output only. Codex has no inline-shell
 * preprocessing, no `$ARGUMENTS`/`$N` substitution, and no `${CLAUDE_*}`
 * expansion, so Claude-only dynamic features are translated into plain prose
 * the Codex agent can act on.
 */

/** The outcome of one fallback rewrite pass. */
export type FallbackResult = {
  body: string;
  /** True when the pass changed anything. */
  changed: boolean;
  /** Tokens that had no sensible translation and were dropped. */
  dropped: string[];
};

const SHELL_NOTE =
  '> Some values below reference shell commands — run them and substitute their output.';

const INLINE_SHELL_PATTERN = /(^|\s)!`([^`]+)`/g;
const SHELL_FENCE_PATTERN = /^(\s*)```!\s*$/;

/**
 * Replace `` !`command` `` tokens with plain `` `command` `` code spans and
 * turn ```` ```! ```` fences into `bash` fences preceded by a run instruction.
 * When anything changed, a one-line note is prepended so the agent knows the
 * commands are meant to be executed.
 */
export function rewriteInlineShell(body: string): FallbackResult {
  let changed = false;

  const lines = body.split('\n').map((line) => {
    const fence = SHELL_FENCE_PATTERN.exec(line);
    if (fence) {
      changed = true;
      return `${fence[1]}Run the following and use its output:\n\n${fence[1]}\`\`\`bash`;
    }

    const replaced = line.replaceAll(INLINE_SHELL_PATTERN, '$1`$2`');
    if (replaced !== line) changed = true;

    return replaced;
  });

  const rewritten = lines.join('\n');

  return {
    body: changed ? `${SHELL_NOTE}\n\n${rewritten}` : rewritten,
    changed,
    dropped: [],
  };
}

const INDEXED_ARGUMENT_PATTERN = /(\\?)\$(?:ARGUMENTS\[(\d+)\]|(\d+))/g;
const ALL_ARGUMENTS_PATTERN = /(\\?)\$ARGUMENTS\b/g;

/** Extract the declared argument names from the `arguments:` frontmatter field. */
export function argumentNames(declaration: string | string[] | undefined): string[] {
  if (declaration === undefined) return [];
  if (Array.isArray(declaration)) return declaration;

  return declaration.split(/\s+/).filter((name) => name.length > 0);
}

function ordinal(index: number): string {
  return `argument ${index + 1} from the user`;
}

/**
 * Replace `$ARGUMENTS`, `$N` / `$ARGUMENTS[N]`, and declared named `$foo`
 * placeholders with prose. A `\$` escape is preserved as a literal `$` (Codex
 * performs no substitution, so the backslash itself must not leak through).
 */
export function rewriteArguments(body: string, names: string[]): FallbackResult {
  let changed = false;

  const substitute = (match: string, escape: string, replacement: string): string => {
    if (escape === '\\') return match.slice(1);

    changed = true;
    return replacement;
  };

  let result = body.replaceAll(
    INDEXED_ARGUMENT_PATTERN,
    (match, escape: string, bracketed: string | undefined, bare: string | undefined) =>
      substitute(match, escape, ordinal(Number(bracketed ?? bare))),
  );
  result = result.replaceAll(ALL_ARGUMENTS_PATTERN, (match, escape: string) =>
    substitute(match, escape, 'the arguments the user provided'),
  );

  for (const name of names) {
    const pattern = new RegExp(String.raw`(\\?)\$${name}\b`, 'g');
    result = result.replaceAll(pattern, (match, escape: string) =>
      substitute(match, escape, `the user-provided "${name}" value`),
    );
  }

  return { body: result, changed, dropped: [] };
}

const ENVIRONMENT_SUBSTITUTIONS: Record<string, string | undefined> = {
  CLAUDE_SKILL_DIR: "this skill's directory",
  CLAUDE_PROJECT_DIR: 'the project root',
  CLAUDE_SESSION_ID: undefined,
  CLAUDE_EFFORT: undefined,
};

const ENVIRONMENT_PATTERN = /\$\{(CLAUDE_[A-Z_]+)\}/g;

/**
 * Replace `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` with prose.
 * `${CLAUDE_SESSION_ID}` and `${CLAUDE_EFFORT}` have no Codex analogue and
 * are dropped (reported in `dropped` so `doctor` can warn).
 */
export function rewriteEnvironmentSubstitutions(body: string): FallbackResult {
  let changed = false;
  const dropped: string[] = [];

  const result = body.replaceAll(ENVIRONMENT_PATTERN, (token, variable: string) => {
    if (!(variable in ENVIRONMENT_SUBSTITUTIONS)) return token;

    changed = true;
    const replacement = ENVIRONMENT_SUBSTITUTIONS[variable];
    if (replacement === undefined) {
      dropped.push(token);
      return '';
    }

    return replacement;
  });

  return { body: result, changed, dropped };
}

/** The combined Codex fallback pipeline: shell, arguments, then env tokens. */
export function applyCodexFallbacks(body: string, names: string[]): FallbackResult {
  const shell = rewriteInlineShell(body);
  const args = rewriteArguments(shell.body, names);
  const environment = rewriteEnvironmentSubstitutions(args.body);

  return {
    body: environment.body,
    changed: shell.changed || args.changed || environment.changed,
    dropped: environment.dropped,
  };
}
