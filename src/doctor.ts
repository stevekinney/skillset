import { z } from 'zod';

import {
  CODEX_DROPPED_AGENT_KEYS,
  CODEX_MANUAL_AGENT_KEYS,
  impliedSandboxMode,
  parseAgentFile,
  type ParsedAgentFile,
} from './agent-frontmatter.js';
import { checkCodexAgentTables } from './agent-codex-checks.js';
import { checkAgentAntiPatterns, checkSkillAntiPatterns } from './doctor-anti-patterns.js';
import { checkInlineMcpServer } from './agent-mcp-servers.js';
import type { SourceAgent, SourceSkill } from './discover.js';
import { applyCodexFallbacks, argumentNames } from './fallback.js';
import { parseSkillFile, type ParsedSkillFile } from './frontmatter.js';
import { unknownClaudeHookFields, type ClaudeHookSettings } from './hook-schema.js';
import { codexUnknownFieldHint, unknownCodexMcpFields } from './mcp-schema.js';
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
/** Device names Windows reserves for a file or folder, with or without an extension. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function windowsReservedName(name: string, kind: 'skill' | 'agent'): Issue[] {
  return WINDOWS_RESERVED_NAME.test(name)
    ? [
        warning(
          `name \`${name}\` is reserved on Windows, so this ${kind} cannot be installed there`,
        ),
      ]
    : [];
}
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

function checkName(name: string, directoryName: string | undefined): Issue[] {
  const issues: Issue[] = [];

  if (!NAME_PATTERN.test(name)) {
    issues.push(
      error(`name \`${name}\` must be lowercase alphanumeric with single hyphens between words`),
    );
  }
  if (name.length > MAXIMUM_NAME_LENGTH) {
    issues.push(error(`name exceeds ${MAXIMUM_NAME_LENGTH} characters`));
  }
  if (directoryName !== undefined && name !== directoryName) {
    issues.push(error(`name \`${name}\` must match its directory name \`${directoryName}\``));
  }
  issues.push(...windowsReservedName(name, 'skill'));

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

function checkHookFields(hooks: ClaudeHookSettings | undefined): Issue[] {
  if (!hooks) return [];

  return unknownClaudeHookFields(hooks).map((path) =>
    warning(`unknown hook field \`${path}\` — Claude Code ignores it`),
  );
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

/**
 * Run every check against a skill whose frontmatter already parsed. `directoryName`
 * is the folder the SKILL.md sits in; without it the name/directory match is skipped.
 */
export function checkParsedSkill(
  parsed: ParsedSkillFile,
  raw: string,
  directoryName?: string,
): Issue[] {
  const { name, description } = parsed.frontmatter;

  return [
    ...checkName(name, directoryName),
    ...checkDescription(description),
    ...checkSkillAntiPatterns(parsed),
    ...checkHookFields(parsed.frontmatter.hooks),
    ...checkBody(parsed, raw),
  ];
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

  return { name: skill.name, issues: checkParsedSkill(parsed, skill.raw, skill.name), parsed };
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

/** Render a parse failure (a `ZodError` or any error) as one readable line. */
export function describeParseFailure(cause: unknown): string {
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

function checkCodexAgentMcpServers(parsed: ParsedAgentFile): Issue[] {
  const servers = parsed.frontmatter.codex?.mcp_servers;
  if (servers === undefined) return [];

  const issues = [
    warning(
      '`codex.mcp_servers` is validated but not applied — Codex 0.160 discards `mcp_servers` from an agent role file even though the Codex docs still list the key; register the server in config.toml instead',
    ),
  ];

  for (const [serverName, section] of Object.entries(servers)) {
    for (const field of unknownCodexMcpFields(section)) {
      const hint = codexUnknownFieldHint(field);
      issues.push(
        warning(
          `codex.mcp_servers.${serverName} has unknown field \`${field}\` — Codex ignores it${hint ? `; ${hint}` : ''}`,
        ),
      );
    }
  }

  return issues;
}

function checkAgentMcpServers(parsed: ParsedAgentFile): Issue[] {
  const inline = (parsed.frontmatter.mcpServers ?? []).flatMap((item, index) =>
    typeof item === 'string' ? [] : checkInlineMcpServer(index, item),
  );

  return [...inline, ...checkCodexAgentMcpServers(parsed)];
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

/**
 * Run every check against an agent whose frontmatter already parsed. `fileName`
 * is the agent's filename without `.md`; without it the name/filename match is skipped.
 */
export function checkParsedAgent(parsed: ParsedAgentFile, fileName?: string): Issue[] {
  const issues: Issue[] = [];
  const { name, description } = parsed.frontmatter;

  if (!NAME_PATTERN.test(name) || name.includes(':')) {
    issues.push(error(`name \`${name}\` must be lowercase alphanumeric with hyphens (no colons)`));
  }
  if (fileName !== undefined && name !== fileName) {
    issues.push(error(`name \`${name}\` must match its filename \`${fileName}.md\``));
  }
  if (description.trim().length === 0) {
    issues.push(error('description must not be empty'));
  }

  issues.push(...windowsReservedName(name, 'agent'));
  issues.push(
    ...checkAgentAntiPatterns(parsed),
    ...checkHookFields(parsed.frontmatter.hooks),
    ...checkAgentBody(parsed),
    ...checkAgentMcpServers(parsed),
    ...checkCodexAgentTables(parsed),
    ...checkAgentCodexMapping(parsed),
  );

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

  return { name: agent.name, issues: checkParsedAgent(parsed, agent.name), parsed };
}

/** Run the doctor across every source agent. */
export function checkAgents(agents: SourceAgent[]): AgentReport[] {
  return agents.map((agent) => checkAgent(agent));
}

/** True when any report carries an error-severity issue. */
export function hasErrors(reports: { issues: Issue[] }[]): boolean {
  return reports.some((report) => report.issues.some((issue) => issue.severity === 'error'));
}
