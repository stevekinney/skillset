import { parseClaudeAgentMapping, type ClaudeAgentFrontmatter } from './agent-frontmatter.js';
import { withoutByteOrderMark } from './byte-order-mark.js';
import { checkParsedAgent, checkParsedSkill } from './doctor.js';
import { splitFrontmatterBlock } from './frontmatter-block.js';
import {
  isMapping,
  parseClaudeSkillMapping,
  parseCodexSkillMapping,
  type ClaudeSkillFrontmatter,
  type CodexSkillFrontmatter,
  type ParsedSkillFile,
  type Target,
} from './frontmatter.js';
import { describeParseFailure, error, hasErrors, type Issue } from './issue.js';

/** What `validateSkillMetadata` and `validateSubagentMetadata` report about one file. */
export type MetadataValidation<Frontmatter> = {
  /** True when no issue has `error` severity. Warnings do not fail validation. */
  valid: boolean;
  /** Every finding. Warnings never make the file invalid. */
  issues: Issue[];
  /** The validated frontmatter. Absent when the frontmatter could not be parsed or failed its schema. */
  frontmatter?: Frontmatter;
  /** The markdown after the closing frontmatter fence. Empty when the frontmatter is unusable. */
  body: string;
};

/** Options for {@link validateSkillMetadata}. */
export type ValidateSkillMetadataOptions = {
  /** Which tool's rules to apply. Defaults to `claude`. */
  target?: Target;
  /** The folder the SKILL.md sits in. When given, `name` must match it. */
  directoryName?: string;
};

/** Options for {@link validateSubagentMetadata}. */
export type ValidateSubagentMetadataOptions = {
  /** The agent's filename without `.md`. When given, `name` must match it. */
  fileName?: string;
};

type Split =
  { ok: true; mapping: Record<string, unknown>; body: string } | { ok: false; issue: Issue };

/**
 * Split a file into its frontmatter mapping and body. A `---js` block is
 * refused rather than run, and nothing here needs Node, so this works in a
 * browser too.
 */
function split(content: string): Split {
  const text = withoutByteOrderMark(content);
  if (!text.startsWith('---')) {
    return { ok: false, issue: error('missing YAML frontmatter (expected a leading `---` block)') };
  }

  let block: { data: unknown; body: string };
  try {
    block = splitFrontmatterBlock(text);
  } catch (cause) {
    return { ok: false, issue: error(`invalid frontmatter — ${describeParseFailure(cause)}`) };
  }

  if (!isMapping(block.data)) {
    return { ok: false, issue: error('frontmatter must be a YAML mapping') };
  }

  return { ok: true, mapping: block.data, body: block.body };
}

function validate<Parsed extends { frontmatter: unknown; body: string }>(
  content: string,
  parseMapping: (mapping: Record<string, unknown>, body: string) => Parsed,
  check: (parsed: Parsed) => Issue[],
): MetadataValidation<Parsed['frontmatter']> {
  const outcome = split(content);
  if (!outcome.ok) return { valid: false, issues: [outcome.issue], body: '' };

  let parsed: Parsed;
  try {
    parsed = parseMapping(outcome.mapping, outcome.body);
  } catch (cause) {
    return {
      valid: false,
      issues: [error(`invalid frontmatter — ${describeParseFailure(cause)}`)],
      body: outcome.body,
    };
  }

  const issues = check(parsed);

  return { valid: !hasErrors(issues), issues, frontmatter: parsed.frontmatter, body: parsed.body };
}

/**
 * Validate the frontmatter of a SKILL.md file.
 *
 * Parses the YAML frontmatter and checks it against the chosen
 * tool's schema: Claude Code's by default, where every field is optional, or
 * Codex's with `target: 'codex'`, where `name` and `description` are required.
 * Then it runs the naming and description rules and flags common anti-patterns,
 * such as a vague name, a first-person description, or a skill nothing can
 * invoke. Never throws for a bad file; read `valid` and `issues`.
 *
 * @param content The full text of the SKILL.md file.
 */
export function validateSkillMetadata(
  content: string,
  options?: ValidateSkillMetadataOptions & { target?: 'claude' },
): MetadataValidation<ClaudeSkillFrontmatter>;
export function validateSkillMetadata(
  content: string,
  options: ValidateSkillMetadataOptions & { target: 'codex' },
): MetadataValidation<CodexSkillFrontmatter>;
export function validateSkillMetadata(
  content: string,
  options?: ValidateSkillMetadataOptions,
): MetadataValidation<ClaudeSkillFrontmatter | CodexSkillFrontmatter>;
export function validateSkillMetadata(
  content: string,
  options: ValidateSkillMetadataOptions = {},
): MetadataValidation<ClaudeSkillFrontmatter | CodexSkillFrontmatter> {
  const { target = 'claude', directoryName } = options;
  const parseMapping: (
    mapping: Record<string, unknown>,
    body: string,
  ) => ParsedSkillFile<ClaudeSkillFrontmatter | CodexSkillFrontmatter> =
    target === 'codex' ? parseCodexSkillMapping : parseClaudeSkillMapping;

  return validate(content, parseMapping, (parsed) =>
    checkParsedSkill(parsed, content, target, directoryName),
  );
}

/**
 * Validate the frontmatter of a Claude Code subagent definition
 * (`.claude/agents/<name>.md`).
 *
 * The same frontmatter parse as {@link validateSkillMetadata}, checked against
 * Claude Code's subagent schema, plus the naming rules, inline `mcpServers`
 * items, hook fields, and anti-patterns such as an empty system prompt,
 * `bypassPermissions`, or a tool both allowed and denied. Never throws for a
 * bad file.
 *
 * @param content The full text of the agent's markdown file.
 */
export function validateSubagentMetadata(
  content: string,
  options: ValidateSubagentMetadataOptions = {},
): MetadataValidation<ClaudeAgentFrontmatter> {
  return validate(content, parseClaudeAgentMapping, (parsed) =>
    checkParsedAgent(parsed, options.fileName),
  );
}
