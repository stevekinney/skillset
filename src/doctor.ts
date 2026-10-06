import type { ParsedAgentFile } from './agent-frontmatter.js';
import { checkInlineMcpServer } from './agent-mcp-servers.js';
import { checkAgentAntiPatterns, checkSkillAntiPatterns } from './doctor-anti-patterns.js';
import type { ParsedSkillFile, Target } from './frontmatter.js';
import { unknownClaudeHookFields, type ClaudeHookSettings } from './hook-schema.js';
import { error, warning, type Issue } from './issue.js';

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Device names Windows reserves for a file or folder, with or without an extension. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const XML_TAG_PATTERN = /<[^>]+>/;
const RESERVED_NAME_WORDS = ['anthropic', 'claude'];
const MAXIMUM_NAME_LENGTH = 64;
const MAXIMUM_DESCRIPTION_LENGTH = 1024;
const RECOMMENDED_MAXIMUM_LINES = 500;

/** The skill fields the checks read, whichever tool's schema parsed them. */
export type SkillFields = {
  name?: string | undefined;
  description?: string | undefined;
  hooks?: ClaudeHookSettings | undefined;
  when_to_use?: string | undefined;
  compatibility?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  agent?: string | undefined;
  context?: 'inline' | 'fork' | undefined;
  'disable-model-invocation'?: boolean | undefined;
  'user-invocable'?: boolean | undefined;
};

function windowsReservedName(name: string, kind: 'skill' | 'agent'): Issue[] {
  return WINDOWS_RESERVED_NAME.test(name)
    ? [
        warning(
          `name \`${name}\` is reserved on Windows, so this ${kind} cannot be installed there`,
        ),
      ]
    : [];
}

/** Claude's platform rejects these words in a skill name. */
function reservedWords(name: string, label: string): Issue[] {
  return RESERVED_NAME_WORDS.filter((word) => name.includes(word)).map((word) =>
    warning(`${label} contains reserved word \`${word}\` — Claude's platform rejects it`),
  );
}

function directoryMismatch(name: string | undefined, directoryName: string | undefined): Issue[] {
  if (name === undefined || directoryName === undefined || name === directoryName) return [];

  return [error(`name \`${name}\` must match its directory name \`${directoryName}\``)];
}

/**
 * The agentskills.io naming rules apply to both tools; the reserved words are
 * Claude's platform rule, so they are checked only for the `claude` target.
 * Claude Code names a skill after its directory when `name` is absent, so the
 * rules then apply to the directory name.
 */
function checkName(
  name: string | undefined,
  directoryName: string | undefined,
  target: Target,
): Issue[] {
  const effectiveName = name ?? directoryName;
  if (effectiveName === undefined) return [];

  const label = name === undefined ? 'directory name' : 'name';
  const issues: Issue[] = [];

  if (!NAME_PATTERN.test(effectiveName)) {
    issues.push(
      error(
        `${label} \`${effectiveName}\` must be lowercase alphanumeric with single hyphens between words`,
      ),
    );
  }
  if (effectiveName.length > MAXIMUM_NAME_LENGTH) {
    issues.push(error(`${label} exceeds ${MAXIMUM_NAME_LENGTH} characters`));
  }

  return [
    ...issues,
    ...directoryMismatch(name, directoryName),
    ...windowsReservedName(effectiveName, 'skill'),
    ...(target === 'claude' ? reservedWords(effectiveName, label) : []),
  ];
}

/** The no-XML-tags rule is Claude's platform rule, so it runs only for the `claude` target. */
function checkDescription(description: string | undefined, target: Target): Issue[] {
  // Only Claude Code allows a missing description; Codex's schema requires it.
  if (description === undefined) {
    return [warning('description is missing — Claude Code decides when to use a skill from it')];
  }

  const issues: Issue[] = [];

  if (description.trim().length === 0) {
    issues.push(error('description must not be empty'));
  }
  if (description.length > MAXIMUM_DESCRIPTION_LENGTH) {
    issues.push(error(`description exceeds ${MAXIMUM_DESCRIPTION_LENGTH} characters`));
  }
  if (target === 'claude' && XML_TAG_PATTERN.test(description)) {
    issues.push(error('description must not contain XML tags'));
  }

  return issues;
}

function checkHookFields(hooks: ClaudeHookSettings | undefined): Issue[] {
  if (!hooks) return [];

  return unknownClaudeHookFields(hooks).map((path) =>
    warning(`unknown hook field \`${path}\` — Claude Code ignores it`),
  );
}

function checkUnknownKeys(unknownKeys: string[], consequence: string): Issue[] {
  return unknownKeys.map((key) => warning(`unknown frontmatter key \`${key}\` — ${consequence}`));
}

function checkLength(raw: string): Issue[] {
  const lineCount = raw.split('\n').length;
  if (lineCount <= RECOMMENDED_MAXIMUM_LINES) return [];

  return [
    warning(
      `SKILL.md is ${lineCount} lines — keep it under ${RECOMMENDED_MAXIMUM_LINES} and move detail into reference files`,
    ),
  ];
}

/**
 * Run every check against a SKILL.md whose frontmatter already parsed.
 * `directoryName` is the folder the file sits in; without it the name/directory
 * match is skipped. Claude-only rules (reserved words, XML tags, hook fields,
 * invocation settings) run only for the `claude` target.
 */
export function checkParsedSkill(
  parsed: ParsedSkillFile<SkillFields>,
  raw: string,
  target: Target,
  directoryName?: string,
): Issue[] {
  const { name, description, hooks } = parsed.frontmatter;

  return [
    ...checkName(name, directoryName, target),
    ...checkDescription(description, target),
    ...checkSkillAntiPatterns(parsed, target),
    ...(target === 'claude' ? checkHookFields(hooks) : []),
    ...checkUnknownKeys(parsed.unknownKeys, 'neither tool reads it'),
    ...checkLength(raw),
  ];
}

/**
 * Run every check against a Claude Code subagent whose frontmatter already
 * parsed. `fileName` is the agent's filename without `.md`; without it the
 * name/filename match is skipped.
 */
export function checkParsedAgent(parsed: ParsedAgentFile, fileName?: string): Issue[] {
  const issues: Issue[] = [];
  const { name, description, hooks, mcpServers } = parsed.frontmatter;

  if (!NAME_PATTERN.test(name)) {
    issues.push(error(`name \`${name}\` must be lowercase alphanumeric with hyphens (no colons)`));
  }
  if (fileName !== undefined && name !== fileName) {
    issues.push(error(`name \`${name}\` must match its filename \`${fileName}.md\``));
  }
  if (description.trim().length === 0) {
    issues.push(error('description must not be empty'));
  }

  issues.push(
    ...windowsReservedName(name, 'agent'),
    ...checkAgentAntiPatterns(parsed),
    ...checkHookFields(hooks),
    ...(mcpServers ?? []).flatMap((item, index) =>
      typeof item === 'string' ? [] : checkInlineMcpServer(index, item),
    ),
    ...checkUnknownKeys(parsed.unknownKeys, 'Claude Code ignores it'),
  );

  return issues;
}
