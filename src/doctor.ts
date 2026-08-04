import { z } from 'zod';

import {
  CODEX_DROPPED_AGENT_KEYS,
  CODEX_MANUAL_AGENT_KEYS,
  impliedSandboxMode,
  parseAgentFile,
  type ParsedAgentFile,
} from './agent-frontmatter.js';
import type { SourceAgent, SourceSkill } from './discover.js';
import { applyCodexFallbacks, argumentNames } from './fallback.js';
import { parseSkillFile, type ParsedSkillFile } from './frontmatter.js';
import { renderConditionals } from './template.js';

/** One finding about a skill. Errors block sync; warnings do not. */
export type Issue = {
  severity: 'error' | 'warning';
  message: string;
};

/** The doctor's verdict on one source skill. */
export type SkillReport = {
  name: string;
  issues: Issue[];
  /** Present when the file parsed cleanly enough to be compiled. */
  parsed?: ParsedSkillFile;
};

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const XML_TAG_PATTERN = /<[^>]+>/;
const RESERVED_NAME_WORDS = ['anthropic', 'claude'];
const MAXIMUM_NAME_LENGTH = 64;
const MAXIMUM_DESCRIPTION_LENGTH = 1024;
const RECOMMENDED_MAXIMUM_LINES = 500;

function error(message: string): Issue {
  return { severity: 'error', message };
}

function warning(message: string): Issue {
  return { severity: 'warning', message };
}

function checkName(name: string, directoryName: string): Issue[] {
  const issues: Issue[] = [];

  if (!NAME_PATTERN.test(name)) {
    issues.push(
      error(`name \`${name}\` must be lowercase alphanumeric with single hyphens between words`),
    );
  }
  if (name.length > MAXIMUM_NAME_LENGTH) {
    issues.push(error(`name exceeds ${MAXIMUM_NAME_LENGTH} characters`));
  }
  if (name !== directoryName) {
    issues.push(error(`name \`${name}\` must match its directory name \`${directoryName}\``));
  }

  for (const word of RESERVED_NAME_WORDS) {
    if (name.includes(word)) {
      issues.push(
        warning(`name contains reserved word \`${word}\` — Claude's platform rejects it`),
      );
    }
  }

  return issues;
}

function checkDescription(description: string): Issue[] {
  const issues: Issue[] = [];

  if (description.trim().length === 0) {
    issues.push(error('description must not be empty'));
  }
  if (description.length > MAXIMUM_DESCRIPTION_LENGTH) {
    issues.push(error(`description exceeds ${MAXIMUM_DESCRIPTION_LENGTH} characters`));
  }
  if (XML_TAG_PATTERN.test(description)) {
    issues.push(error('description must not contain XML tags'));
  }

  return issues;
}

function checkBody(parsed: ParsedSkillFile, raw: string): Issue[] {
  const issues: Issue[] = [];

  const lineCount = raw.split('\n').length;
  if (lineCount > RECOMMENDED_MAXIMUM_LINES) {
    issues.push(
      warning(
        `SKILL.md is ${lineCount} lines — keep it under ${RECOMMENDED_MAXIMUM_LINES} and move detail into reference files`,
      ),
    );
  }

  for (const key of parsed.unknownKeys) {
    issues.push(warning(`unknown frontmatter key \`${key}\` — neither tool understands it`));
  }

  const structural = renderConditionals(parsed.body, 'claude');
  for (const templateError of structural.errors) {
    issues.push(error(`line ${templateError.line}: ${templateError.message}`));
  }
  if (structural.errors.length > 0) return issues;

  const codexBody = renderConditionals(parsed.body, 'codex').body;
  const fallbacks = applyCodexFallbacks(codexBody, argumentNames(parsed.frontmatter.arguments));

  if (fallbacks.changed) {
    issues.push(
      warning(
        'body uses Claude-only dynamic features outside an `#if claude` guard — the Codex output rewrites them as prose; check the translation',
      ),
    );
  }
  for (const token of fallbacks.dropped) {
    issues.push(
      warning(`\`${token}\` has no Codex equivalent and is dropped — guard it with \`#if claude\``),
    );
  }

  return issues;
}

/** Run every check against one source skill. */
export function checkSkill(skill: SourceSkill): SkillReport {
  let parsed: ParsedSkillFile;

  try {
    parsed = parseSkillFile(skill.raw);
  } catch (cause) {
    return {
      name: skill.name,
      issues: [error(`invalid frontmatter — ${describeParseFailure(cause)}`)],
    };
  }

  const issues = [
    ...checkName(parsed.frontmatter.name, skill.name),
    ...checkDescription(parsed.frontmatter.description),
    ...checkBody(parsed, skill.raw),
  ];

  return { name: skill.name, issues, parsed };
}

/** Run the doctor across every source skill. */
export function checkSkills(skills: SourceSkill[]): SkillReport[] {
  return skills.map((skill) => checkSkill(skill));
}

/** The doctor's verdict on one source agent. */
export type AgentReport = {
  name: string;
  issues: Issue[];
  /** Present when the file parsed cleanly enough to be compiled. */
  parsed?: ParsedAgentFile;
};

function describeParseFailure(cause: unknown): string {
  if (cause instanceof z.ZodError) {
    return cause.issues
      .map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`)
      .join('; ');
  }

  return cause instanceof Error ? cause.message : String(cause);
}

function checkAgentBody(parsed: ParsedAgentFile): Issue[] {
  const issues: Issue[] = [];

  for (const key of parsed.unknownKeys) {
    issues.push(warning(`unknown frontmatter key \`${key}\` — neither tool understands it`));
  }

  const structural = renderConditionals(parsed.body, 'claude');
  for (const templateError of structural.errors) {
    issues.push(error(`line ${templateError.line}: ${templateError.message}`));
  }
  if (structural.errors.length > 0) return issues;

  const codexBody = renderConditionals(parsed.body, 'codex').body;
  const fallbacks = applyCodexFallbacks(codexBody, []);

  if (fallbacks.changed) {
    issues.push(
      warning(
        'body uses Claude-only dynamic features outside an `#if claude` guard — the Codex output rewrites them as prose; check the translation',
      ),
    );
  }
  for (const token of fallbacks.dropped) {
    issues.push(
      warning(`\`${token}\` has no Codex equivalent and is dropped — guard it with \`#if claude\``),
    );
  }

  return issues;
}

function checkDroppedAgentKeys(record: Record<string, unknown>): Issue[] {
  return CODEX_DROPPED_AGENT_KEYS.filter((key) => record[key] !== undefined).map((key) =>
    warning(`\`${key}\` has no documented Codex equivalent — dropped from the Codex output`),
  );
}

function checkManualAgentKeys(parsed: ParsedAgentFile, record: Record<string, unknown>): Issue[] {
  return CODEX_MANUAL_AGENT_KEYS.filter(
    (mapping) =>
      record[mapping.claude] !== undefined &&
      parsed.frontmatter.codex?.[mapping.codex] === undefined,
  ).map((mapping) =>
    warning(
      `\`${mapping.claude}\` is not auto-translated — Codex agents support their own \`${mapping.codex}\` table with a different schema; set \`codex.${mapping.codex}\` explicitly`,
    ),
  );
}

function checkAgentCodexMapping(parsed: ParsedAgentFile): Issue[] {
  const record = parsed.frontmatter as Record<string, unknown>;
  const issues = [...checkDroppedAgentKeys(record), ...checkManualAgentKeys(parsed, record)];

  for (const key of ['tools', 'disallowedTools'] as const) {
    if (record[key] === undefined) continue;

    issues.push(
      warning(
        `\`${key}\` is folded into the Codex developer instructions as prose — set \`codex.tools\` for Codex's native form`,
      ),
    );
  }

  const { permissionMode, codex } = parsed.frontmatter;
  if (permissionMode && !codex?.sandbox_mode && !impliedSandboxMode(permissionMode)) {
    issues.push(
      warning(
        `permissionMode \`${permissionMode}\` has no Codex sandbox_mode mapping — set \`codex.sandbox_mode\` explicitly`,
      ),
    );
  }

  return issues;
}

/** Run every check against one source agent. */
export function checkAgent(agent: SourceAgent): AgentReport {
  let parsed: ParsedAgentFile;

  try {
    parsed = parseAgentFile(agent.raw);
  } catch (cause) {
    return {
      name: agent.name,
      issues: [error(`invalid frontmatter — ${describeParseFailure(cause)}`)],
    };
  }

  const issues: Issue[] = [];
  const { name, description } = parsed.frontmatter;

  if (!NAME_PATTERN.test(name) || name.includes(':')) {
    issues.push(error(`name \`${name}\` must be lowercase alphanumeric with hyphens (no colons)`));
  }
  if (name !== agent.name) {
    issues.push(error(`name \`${name}\` must match its filename \`${agent.name}.md\``));
  }
  if (description.trim().length === 0) {
    issues.push(error('description must not be empty'));
  }

  issues.push(...checkAgentBody(parsed), ...checkAgentCodexMapping(parsed));

  return { name: agent.name, issues, parsed };
}

/** Run the doctor across every source agent. */
export function checkAgents(agents: SourceAgent[]): AgentReport[] {
  return agents.map((agent) => checkAgent(agent));
}

/** True when any report carries an error-severity issue. */
export function hasErrors(reports: { issues: Issue[] }[]): boolean {
  return reports.some((report) => report.issues.some((issue) => issue.severity === 'error'));
}
