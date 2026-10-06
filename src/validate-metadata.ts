import matter from 'gray-matter';
import { parse } from 'yaml';

import { parseAgentMapping, type AgentFrontmatter } from './agent-frontmatter.js';
import { withoutByteOrderMark } from './byte-order-mark.js';
import { checkParsedAgent, checkParsedSkill, describeParseFailure, type Issue } from './doctor.js';
import { isMapping, parseSkillMapping, type SkillFrontmatter } from './frontmatter.js';
import { structurallyEqual } from './ledger.js';

/** What `validateSkillMetadata` and `validateSubagentMetadata` report about one file. */
export type MetadataValidation<Frontmatter> = {
  /** True when no issue has `error` severity. Warnings do not fail validation. */
  valid: boolean;
  /** Every finding, errors first as found; warnings never block. */
  issues: Issue[];
  /** The validated frontmatter. Absent when the frontmatter could not be parsed or failed its schema. */
  frontmatter?: Frontmatter;
  /** The markdown after the closing frontmatter fence. Empty when the frontmatter is unusable. */
  body: string;
};

/** Options for {@link validateSkillMetadata}. */
export type ValidateSkillMetadataOptions = {
  /** The folder the SKILL.md sits in. When given, `name` must match it. */
  directoryName?: string;
};

/** Options for {@link validateSubagentMetadata}. */
export type ValidateSubagentMetadataOptions = {
  /** The agent's filename without `.md`. When given, `name` must match it. */
  fileName?: string;
};

type Split =
  | { ok: true; mapping: Record<string, unknown>; body: string; block: string }
  | { ok: false; issue: Issue };

function failure(message: string): Split {
  return { ok: false, issue: { severity: 'error', message } };
}

/** Throws for the `---js` and `---coffee` fences, which gray-matter would otherwise `eval`. */
function refuseExecutableFrontmatter(): never {
  throw new Error('executable frontmatter is not allowed — use YAML');
}

/**
 * Split a file into its frontmatter mapping and body with gray-matter. The
 * executable engines are replaced so a `---js` block can never run code, and
 * passing options also bypasses gray-matter's content-keyed cache.
 */
function split(content: string): Split {
  const text = withoutByteOrderMark(content);
  if (!text.startsWith('---')) {
    return failure('missing YAML frontmatter (expected a leading `---` block)');
  }

  let file: matter.GrayMatterFile<string>;
  try {
    file = matter(text, {
      engines: {
        js: refuseExecutableFrontmatter,
        javascript: refuseExecutableFrontmatter,
        coffee: refuseExecutableFrontmatter,
        coffeescript: refuseExecutableFrontmatter,
        cson: refuseExecutableFrontmatter,
      },
    });
  } catch (cause) {
    return failure(`invalid frontmatter — ${describeParseFailure(cause)}`);
  }

  if (!isMapping(file.data)) return failure('frontmatter must be a YAML mapping');

  return { ok: true, mapping: file.data, body: file.content, block: file.matter };
}

/**
 * gray-matter and the `yaml` package that compiles sources do not read every
 * block alike: an unquoted date is a Date to one and a string to the other, `010`
 * is octal to one, and the `yaml` package rejects tab indentation that gray-matter
 * tolerates. A block the two disagree on validates here and still compiles to
 * something different, or not at all.
 */
function checkParserDifference(mapping: Record<string, unknown>, block: string): Issue[] {
  let compiled: unknown;
  try {
    compiled = parse(block);
  } catch (cause) {
    return [
      {
        severity: 'warning',
        message: `gray-matter reads this frontmatter but the compiler's YAML parser does not — ${describeParseFailure(cause).split('\n')[0]}`,
      },
    ];
  }
  if (structurallyEqual(compiled, mapping)) return [];

  return [
    {
      severity: 'warning',
      message:
        'gray-matter and the compiler read this frontmatter differently (an unquoted date or a number with a leading zero) — quote the value so every tool reads the same thing',
    },
  ];
}

function validate<Frontmatter>(
  content: string,
  parseMapping: (
    mapping: Record<string, unknown>,
    body: string,
  ) => { frontmatter: Frontmatter; unknownKeys: string[]; body: string },
  check: (parsed: ReturnType<typeof parseMapping>) => Issue[],
): MetadataValidation<Frontmatter> {
  const outcome = split(content);
  if (!outcome.ok) return { valid: false, issues: [outcome.issue], body: '' };

  let parsed: ReturnType<typeof parseMapping>;
  try {
    parsed = parseMapping(outcome.mapping, outcome.body);
  } catch (cause) {
    return {
      valid: false,
      issues: [
        { severity: 'error', message: `invalid frontmatter — ${describeParseFailure(cause)}` },
      ],
      body: outcome.body,
    };
  }

  const issues = [...checkParserDifference(outcome.mapping, outcome.block), ...check(parsed)];

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

/**
 * Validate the frontmatter of a SKILL.md file.
 *
 * Parses the YAML frontmatter with gray-matter, checks it against the skill
 * schema, and runs every rule `skillset doctor` runs on a skill: naming,
 * description, template and Codex-fallback problems, hook fields, and common
 * anti-patterns such as a vague name, a first-person description, or a skill
 * nothing can invoke. Never throws for a bad file; read `valid` and `issues`.
 *
 * @param content The full text of the SKILL.md file.
 */
export function validateSkillMetadata(
  content: string,
  options: ValidateSkillMetadataOptions = {},
): MetadataValidation<SkillFrontmatter> {
  return validate(content, parseSkillMapping, (parsed) =>
    checkParsedSkill(parsed, content, options.directoryName),
  );
}

/**
 * Validate the frontmatter of a subagent definition (`agents/<name>.md`).
 *
 * The subagent counterpart of {@link validateSkillMetadata}: the same gray-matter
 * parse, the agent schema, and every rule `skillset doctor` runs on an agent,
 * plus anti-patterns such as an empty system prompt, `bypassPermissions`, or a
 * tool both allowed and denied. Never throws for a bad file.
 *
 * @param content The full text of the agent's markdown file.
 */
export function validateSubagentMetadata(
  content: string,
  options: ValidateSubagentMetadataOptions = {},
): MetadataValidation<AgentFrontmatter> {
  return validate(content, parseAgentMapping, (parsed) =>
    checkParsedAgent(parsed, options.fileName),
  );
}
