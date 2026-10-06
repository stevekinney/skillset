import type { ParsedAgentFile } from './agent-frontmatter.js';
import type { Issue } from './doctor.js';
import type { ParsedSkillFile } from './frontmatter.js';

const VAGUE_NAMES = new Set([
  'helper',
  'helpers',
  'utils',
  'utility',
  'utilities',
  'tool',
  'tools',
  'misc',
  'stuff',
  'data',
  'files',
  'documents',
]);
/** A description that speaks as "I"/"we"/"you" instead of describing the skill. */
const POINT_OF_VIEW_PATTERN = /^\s*(i|i'm|i'll|we|you|your)\b/i;
/** Claude Code truncates `description` + `when_to_use` in the skill listing at this length. */
const LISTING_LIMIT = 1536;
const MAXIMUM_COMPATIBILITY_LENGTH = 500;

function warning(message: string): Issue {
  return { severity: 'warning', message };
}

function toolList(value: string | string[] | undefined): string[] {
  const items = typeof value === 'string' ? value.split(',') : (value ?? []);

  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function checkDescriptionStyle(parsed: ParsedSkillFile): Issue[] {
  const { description, when_to_use: whenToUse } = parsed.frontmatter;
  const issues: Issue[] = [];

  if (POINT_OF_VIEW_PATTERN.test(description)) {
    issues.push(
      warning(
        'description should be written in the third person ("Extracts text from PDFs"), not as "I", "we", or "you"',
      ),
    );
  }
  if (description.length + (whenToUse?.length ?? 0) > LISTING_LIMIT) {
    issues.push(
      warning(
        `description and when_to_use together exceed ${LISTING_LIMIT} characters — Claude Code truncates them in the skill listing`,
      ),
    );
  }

  return issues;
}

function checkSpecFields(parsed: ParsedSkillFile): Issue[] {
  const { compatibility, metadata } = parsed.frontmatter;
  const issues: Issue[] = [];

  if (compatibility !== undefined && compatibility.length > MAXIMUM_COMPATIBILITY_LENGTH) {
    issues.push({
      severity: 'error',
      message: `compatibility exceeds ${MAXIMUM_COMPATIBILITY_LENGTH} characters`,
    });
  }
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (typeof value === 'string') continue;
    issues.push(
      warning(
        `metadata.${key} should be a string — the agentskills.io spec maps strings to strings`,
      ),
    );
  }

  return issues;
}

function checkInvocation(parsed: ParsedSkillFile): Issue[] {
  const { agent, context } = parsed.frontmatter;
  const issues: Issue[] = [];

  if (
    parsed.frontmatter['disable-model-invocation'] === true &&
    parsed.frontmatter['user-invocable'] === false
  ) {
    issues.push(
      warning(
        '`disable-model-invocation: true` with `user-invocable: false` leaves nothing able to invoke the skill',
      ),
    );
  }
  if (agent !== undefined && context !== 'fork') {
    issues.push(warning('`agent` only applies with `context: fork` — it is ignored here'));
  }

  return issues;
}

/** Common skill misconfigurations that are valid frontmatter but almost never intended. */
export function checkSkillAntiPatterns(parsed: ParsedSkillFile): Issue[] {
  const { name } = parsed.frontmatter;
  const issues = [
    ...checkDescriptionStyle(parsed),
    ...checkSpecFields(parsed),
    ...checkInvocation(parsed),
  ];

  if (VAGUE_NAMES.has(name)) {
    issues.unshift(warning(`name \`${name}\` is vague — name the skill for what it does`));
  }
  if (parsed.body.trim().length === 0) {
    issues.push(warning('the skill body is empty — add the instructions Claude should follow'));
  }

  return issues;
}

/** Common agent misconfigurations that are valid frontmatter but almost never intended. */
export function checkAgentAntiPatterns(parsed: ParsedAgentFile): Issue[] {
  const { tools, disallowedTools, permissionMode } = parsed.frontmatter;
  const issues: Issue[] = [];

  if (parsed.body.trim().length === 0) {
    issues.push(warning("the agent body is empty — it is the agent's system prompt"));
  }
  if (permissionMode === 'bypassPermissions') {
    issues.push(
      warning('`permissionMode: bypassPermissions` skips every permission prompt for this agent'),
    );
  }

  const denied = new Set(toolList(disallowedTools));
  for (const tool of toolList(tools)) {
    if (denied.has(tool)) {
      issues.push(warning(`\`${tool}\` is in both \`tools\` and \`disallowedTools\``));
    }
  }

  return issues;
}
