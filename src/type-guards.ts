import { z } from 'zod';

import { claudeAgentFrontmatterSchema, codexAgentSchema } from './agent-frontmatter.js';
import { claudeAgentMcpServerSchema } from './agent-mcp-servers.js';
import { claudeHookInputSchema, claudeHookInputSchemas } from './claude-hook-input-schemas.js';
import { claudeHookOutputOrAsyncSchema } from './claude-hook-output-schemas.js';
import type { ClaudeHookEventName } from './claude-hook-shared.js';
import {
  claudeSessionRecordSchema,
  claudeSessionRecordSchemas,
  type ClaudeSessionRecordType,
} from './claude-session-record-schema.js';
import { claudeWorkflowJournalRecordSchema } from './claude-session-workflow-journal.js';
import {
  claudeWorkflowAgentOptionsSchema,
  claudeWorkflowOutputSchemaSchema,
} from './claude-workflow-agent-options.js';
import { claudeWorkflowMetaSchema } from './claude-workflow-meta.js';
import { claudeWorkflowRunRecordSchema } from './claude-workflow-run-record.js';
import {
  claudeWorkflowBudgetSchema,
  claudeWorkflowReferenceSchema,
  claudeWorkflowToolInputSchema,
  claudeWorkflowToolOutputSchema,
} from './claude-workflow-tool.js';
import {
  codexHookInputSchema,
  codexHookInputSchemas,
  codexHookOutputSchemas,
  type CodexHookEventName,
} from './codex-hook-payloads.js';
import { codexSkillsSchema, codexToolsSchema } from './codex-agent-tables.js';
import {
  codexSessionRecordSchema,
  codexSessionRecordSchemas,
  type CodexSessionRecordType,
} from './codex-session-records.js';
import {
  claudeEffortSchema,
  claudeSettingsEffortSchema,
  claudeSkillFrontmatterSchema,
  codexSkillFrontmatterSchema,
  openaiConfigurationSchema,
} from './frontmatter.js';
import { claudeHookSettingsSchema, codexHookSettingsSchema } from './hook-schema.js';
import { claudeMcpServerSchema, codexMcpServerSchema } from './mcp-schema.js';

/**
 * A type guard backed by a schema. It narrows to the schema's *input* type:
 * a few schemas convert values while parsing (skill booleans accept `"yes"`,
 * some strings are trimmed), so the value
 * being checked has the input shape, not the parsed one. For schemas that
 * convert nothing the two types are the same. Parse with the schema to get the
 * converted value.
 */
function schemaGuard<Schema extends z.ZodType>(schema: Schema) {
  return (value: unknown): value is z.input<Schema> => schema.safeParse(value).success;
}

/** Whether a value is valid Claude Code SKILL.md frontmatter. */
export const isClaudeSkillFrontmatter = schemaGuard(claudeSkillFrontmatterSchema);

/** Whether a value is valid Codex SKILL.md frontmatter. */
export const isCodexSkillFrontmatter = schemaGuard(codexSkillFrontmatterSchema);

/** Whether a value is valid Claude Code subagent frontmatter. */
export const isClaudeAgentFrontmatter = schemaGuard(claudeAgentFrontmatterSchema);

/** Whether a value is a valid Codex custom agent file, as parsed TOML. */
export const isCodexAgent = schemaGuard(codexAgentSchema);

/** Whether a value is a valid `agents/openai.yaml` configuration. */
export const isOpenaiConfiguration = schemaGuard(openaiConfigurationSchema);

/** Whether a value is a valid Claude Code skill or subagent `effort`. */
export const isClaudeEffort = schemaGuard(claudeEffortSchema);

/** Whether a value is a valid Claude Code settings.json `effortLevel`. */
export const isClaudeSettingsEffort = schemaGuard(claudeSettingsEffortSchema);

/** Whether a value is a valid Claude Code `hooks` block (settings.json, skill, or subagent). */
export const isClaudeHookSettings = schemaGuard(claudeHookSettingsSchema);

/** Whether a value is a valid Codex `hooks` table (hooks.json `hooks` or config.toml `[hooks]`). */
export const isCodexHookSettings = schemaGuard(codexHookSettingsSchema);

/** Whether a value is a valid Claude Code `mcpServers` entry. */
export const isClaudeMcpServer = schemaGuard(claudeMcpServerSchema);

/** Whether a value is a subagent `mcpServers` item Claude Code keeps. */
export const isClaudeAgentMcpServer = schemaGuard(claudeAgentMcpServerSchema);

/** Whether a value is a valid Codex `[mcp_servers.<name>]` table. */
export const isCodexMcpServer = schemaGuard(codexMcpServerSchema);

/** Whether a value is a valid Codex `[skills]` table (config.toml or an agent file). */
export const isCodexSkills = schemaGuard(codexSkillsSchema);

/** Whether a value is a valid Codex `[tools]` table (config.toml or an agent file). */
export const isCodexTools = schemaGuard(codexToolsSchema);

/** Whether a value is a valid Claude Code hook stdin payload for any event. */
export const isClaudeHookInput = schemaGuard(claudeHookInputSchema);

/** Whether a value is valid Claude Code command-hook stdout (synchronous or async). */
export const isClaudeHookOutput = schemaGuard(claudeHookOutputOrAsyncSchema);

/** Whether a value is a valid Codex hook stdin payload for any event. */
export const isCodexHookInput = schemaGuard(codexHookInputSchema);

/** Whether a value is a valid Claude Code hook stdin payload for one event. */
export function isClaudeHookInputFor<Name extends ClaudeHookEventName>(
  eventName: Name,
  value: unknown,
): value is z.input<(typeof claudeHookInputSchemas)[Name]> {
  return claudeHookInputSchemas[eventName].safeParse(value).success;
}

/** Whether a value is a valid Codex hook stdin payload for one event. */
export function isCodexHookInputFor<Name extends CodexHookEventName>(
  eventName: Name,
  value: unknown,
): value is z.input<(typeof codexHookInputSchemas)[Name]> {
  return codexHookInputSchemas[eventName].safeParse(value).success;
}

/** Whether a value is valid Codex hook stdout for one event. */
export function isCodexHookOutputFor<Name extends CodexHookEventName>(
  eventName: Name,
  value: unknown,
): value is z.input<(typeof codexHookOutputSchemas)[Name]> {
  return codexHookOutputSchemas[eventName].safeParse(value).success;
}

/** Whether a value is one record (one line) of a Claude Code session transcript. */
export const isClaudeSessionRecord = schemaGuard(claudeSessionRecordSchema);

/** Whether a value is one record of a Claude Code workflow `journal.jsonl`. */
export const isClaudeWorkflowJournalRecord = schemaGuard(claudeWorkflowJournalRecordSchema);

/** Whether a value is a workflow script's `meta` block, once evaluated. */
export const isClaudeWorkflowMeta = schemaGuard(claudeWorkflowMetaSchema);

/** Whether a value is a valid `agent()` options object. */
export const isClaudeWorkflowAgentOptions = schemaGuard(claudeWorkflowAgentOptionsSchema);

/** Whether a value is a valid `agent()` output schema (a JSON Schema object root). */
export const isClaudeWorkflowOutputSchema = schemaGuard(claudeWorkflowOutputSchemaSchema);

/** Whether a value is a valid input of the `Workflow` tool. */
export const isClaudeWorkflowToolInput = schemaGuard(claudeWorkflowToolInputSchema);

/** Whether a value is a valid result of the `Workflow` tool. */
export const isClaudeWorkflowToolOutput = schemaGuard(claudeWorkflowToolOutputSchema);

/** Whether a value is a valid `workflow()` reference: a saved name or `{ scriptPath }`. */
export const isClaudeWorkflowReference = schemaGuard(claudeWorkflowReferenceSchema);

/** Whether a value has the shape of the script's `budget` global. */
export const isClaudeWorkflowBudget = schemaGuard(claudeWorkflowBudgetSchema);

/** Whether a value is a finished run's `wf_<id>.json` record. */
export const isClaudeWorkflowRunRecord = schemaGuard(claudeWorkflowRunRecordSchema);

/** Whether a value is one record (one line) of a Codex session rollout. */
export const isCodexSessionRecord = schemaGuard(codexSessionRecordSchema);

/** Whether a value is a Claude Code session transcript record of one `type`. */
export function isClaudeSessionRecordFor<Type extends ClaudeSessionRecordType>(
  type: Type,
  value: unknown,
): value is z.input<(typeof claudeSessionRecordSchemas)[Type]> {
  return claudeSessionRecordSchemas[type].safeParse(value).success;
}

/** Whether a value is a Codex session rollout record of one `type`. */
export function isCodexSessionRecordFor<Type extends CodexSessionRecordType>(
  type: Type,
  value: unknown,
): value is z.input<(typeof codexSessionRecordSchemas)[Type]> {
  return codexSessionRecordSchemas[type].safeParse(value).success;
}
