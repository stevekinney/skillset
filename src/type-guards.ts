import { z } from 'zod';

import { claudeAgentFrontmatterSchema, codexAgentSchema } from './agent-frontmatter.js';
import { claudeAgentMcpServerSchema } from './agent-mcp-servers.js';
import { claudeHookInputSchema, claudeHookInputSchemas } from './claude-hook-input-schemas.js';
import {
  claudeAsyncHookOutputSchema,
  claudeHookOutputOrAsyncSchema,
  claudeHookOutputSchema,
  claudeHookSpecificOutputSchema,
  claudeHookSpecificOutputSchemas,
} from './claude-hook-output-schemas.js';
import {
  claudeCommonHookInputSchema,
  claudePermissionUpdateSchema,
  type ClaudeHookEventName,
} from './claude-hook-shared.js';
import {
  claudeSessionAttachmentRecordSchema,
  claudeSessionAttachmentSchema,
} from './claude-session-attachment-schemas.js';
import {
  claudeSessionAssistantContentBlockSchema,
  claudeSessionUserContentBlockSchema,
} from './claude-session-content-blocks.js';
import {
  claudeSessionAssistantRecordSchema,
  claudeSessionUserRecordSchema,
} from './claude-session-conversation-schemas.js';
import {
  claudeSessionAssistantMessageSchema,
  claudeSessionUsageSchema,
  claudeSessionUserMessageSchema,
} from './claude-session-message-schemas.js';
import {
  claudeSessionRecordSchema,
  claudeSessionRecordSchemas,
  type ClaudeSessionRecordType,
} from './claude-session-record-schema.js';
import { claudeSessionStateRecordSchemas } from './claude-session-state-schemas.js';
import {
  claudeSessionSystemRecordSchema,
  claudeSessionSystemRecordSchemas,
} from './claude-session-system-schemas.js';
import { claudeSessionToolUseResultSchema } from './claude-session-tool-result-schemas.js';
import {
  claudeWorkflowJournalRecordSchema,
  claudeWorkflowJournalRecordSchemas,
} from './claude-session-workflow-journal.js';
import {
  claudeWorkflowAgentOptionsSchema,
  claudeWorkflowEffortSchema,
  claudeWorkflowIsolationSchema,
  claudeWorkflowOutputSchemaSchema,
} from './claude-workflow-agent-options.js';
import { claudeWorkflowMetaSchema, claudeWorkflowPhaseSchema } from './claude-workflow-meta.js';
import {
  claudeWorkflowProgressAgentSchema,
  claudeWorkflowProgressPhaseSchema,
  claudeWorkflowProgressRowSchema,
  claudeWorkflowRunRecordSchema,
} from './claude-workflow-run-record.js';
import {
  claudeWorkflowBudgetSchema,
  claudeWorkflowReferenceSchema,
  claudeWorkflowRunIdSchema,
  claudeWorkflowToolInputSchema,
  claudeWorkflowToolOutputSchema,
} from './claude-workflow-tool.js';
import { codexSkillsSchema, codexToolsSchema } from './codex-agent-tables.js';
import {
  codexHookInputSchema,
  codexHookInputSchemas,
  codexHookOutputSchemas,
  codexPostModelRequestMcpStructuredContentSchema,
  type CodexHookEventName,
} from './codex-hook-payloads.js';
import { codexCompactedPayloadSchema } from './codex-session-compaction.js';
import { codexEventMessageSchema, codexEventMessageSchemas } from './codex-session-events.js';
import {
  codexDynamicToolsUpdatedPayloadSchema,
  codexSessionMetaPayloadSchema,
  codexTurnContextPayloadSchema,
} from './codex-session-metadata.js';
import {
  codexSessionRecordSchema,
  codexSessionRecordSchemas,
  type CodexSessionRecordType,
} from './codex-session-records.js';
import { codexResponseItemSchema } from './codex-session-response-items.js';
import { codexTurnItemSchema } from './codex-session-turn-items.js';
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

/** Whether a value is valid PostModelRequest MCP structured content. */
export const isCodexPostModelRequestMcpStructuredContent = schemaGuard(
  codexPostModelRequestMcpStructuredContentSchema,
);

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

/** Whether a value is an event payload from a Codex session rollout. */
export const isCodexEventMessage = schemaGuard(codexEventMessageSchema);

/** Whether a value is a response item from a Codex session rollout. */
export const isCodexResponseItem = schemaGuard(codexResponseItemSchema);

/** Whether a value is a persisted Codex turn item. */
export const isCodexTurnItem = schemaGuard(codexTurnItemSchema);

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

/** Check the input accepted by {@link claudeAsyncHookOutputSchema}. */
export const isClaudeAsyncHookOutput = schemaGuard(claudeAsyncHookOutputSchema);

/** Check the input accepted by {@link claudeCommonHookInputSchema}. */
export const isClaudeCommonHookInput = schemaGuard(claudeCommonHookInputSchema);

/** Check the input accepted by {@link claudeHookOutputOrAsyncSchema}. */
export const isClaudeHookOutputOrAsync = isClaudeHookOutput;

/** Check the input accepted by {@link claudeHookSpecificOutputSchema}. */
export const isClaudeHookSpecificOutput = schemaGuard(claudeHookSpecificOutputSchema);

/** Check the input accepted by {@link claudePermissionUpdateSchema}. */
export const isClaudePermissionUpdate = schemaGuard(claudePermissionUpdateSchema);

/** Check the input accepted by {@link claudeSessionAssistantContentBlockSchema}. */
export const isClaudeSessionAssistantContentBlock = schemaGuard(
  claudeSessionAssistantContentBlockSchema,
);

/** Check the input accepted by {@link claudeSessionAssistantMessageSchema}. */
export const isClaudeSessionAssistantMessage = schemaGuard(claudeSessionAssistantMessageSchema);

/** Check the input accepted by {@link claudeSessionAssistantRecordSchema}. */
export const isClaudeSessionAssistantRecord = schemaGuard(claudeSessionAssistantRecordSchema);

/** Check the input accepted by {@link claudeSessionAttachmentRecordSchema}. */
export const isClaudeSessionAttachmentRecord = schemaGuard(claudeSessionAttachmentRecordSchema);

/** Check the input accepted by {@link claudeSessionAttachmentSchema}. */
export const isClaudeSessionAttachment = schemaGuard(claudeSessionAttachmentSchema);

/** Check the input accepted by {@link claudeSessionSystemRecordSchema}. */
export const isClaudeSessionSystemRecord = schemaGuard(claudeSessionSystemRecordSchema);

/** Check the input accepted by {@link claudeSessionToolUseResultSchema}. */
export const isClaudeSessionToolUseResult = schemaGuard(claudeSessionToolUseResultSchema);

/** Check the input accepted by {@link claudeSessionUsageSchema}. */
export const isClaudeSessionUsage = schemaGuard(claudeSessionUsageSchema);

/** Check the input accepted by {@link claudeSessionUserContentBlockSchema}. */
export const isClaudeSessionUserContentBlock = schemaGuard(claudeSessionUserContentBlockSchema);

/** Check the input accepted by {@link claudeSessionUserMessageSchema}. */
export const isClaudeSessionUserMessage = schemaGuard(claudeSessionUserMessageSchema);

/** Check the input accepted by {@link claudeSessionUserRecordSchema}. */
export const isClaudeSessionUserRecord = schemaGuard(claudeSessionUserRecordSchema);

/** Check the input accepted by {@link claudeWorkflowEffortSchema}. */
export const isClaudeWorkflowEffort = schemaGuard(claudeWorkflowEffortSchema);

/** Check the input accepted by {@link claudeWorkflowIsolationSchema}. */
export const isClaudeWorkflowIsolation = schemaGuard(claudeWorkflowIsolationSchema);

/** Check the input accepted by {@link claudeWorkflowPhaseSchema}. */
export const isClaudeWorkflowPhase = schemaGuard(claudeWorkflowPhaseSchema);

/** Check the input accepted by {@link claudeWorkflowProgressAgentSchema}. */
export const isClaudeWorkflowProgressAgent = schemaGuard(claudeWorkflowProgressAgentSchema);

/** Check the input accepted by {@link claudeWorkflowProgressPhaseSchema}. */
export const isClaudeWorkflowProgressPhase = schemaGuard(claudeWorkflowProgressPhaseSchema);

/** Check the input accepted by {@link claudeWorkflowProgressRowSchema}. */
export const isClaudeWorkflowProgressRow = schemaGuard(claudeWorkflowProgressRowSchema);

/** Check the input accepted by {@link claudeWorkflowRunIdSchema}. */
export const isClaudeWorkflowRunId = schemaGuard(claudeWorkflowRunIdSchema);

/** Check the input accepted by {@link codexCompactedPayloadSchema}. */
export const isCodexCompactedPayload = schemaGuard(codexCompactedPayloadSchema);

/** Check the input accepted by {@link codexDynamicToolsUpdatedPayloadSchema}. */
export const isCodexDynamicToolsUpdatedPayload = schemaGuard(codexDynamicToolsUpdatedPayloadSchema);

/** Check the input accepted by {@link codexSessionMetaPayloadSchema}. */
export const isCodexSessionMetaPayload = schemaGuard(codexSessionMetaPayloadSchema);

/** Check the input accepted by {@link codexTurnContextPayloadSchema}. */
export const isCodexTurnContextPayload = schemaGuard(codexTurnContextPayloadSchema);

/** Check the input accepted by {@link claudeHookOutputSchema}. */
export const isClaudeSyncHookOutput = schemaGuard(claudeHookOutputSchema);

/** Check an input for one key in {@link claudeHookSpecificOutputSchemas}. */
export function isClaudeHookSpecificOutputFor<
  Key extends keyof typeof claudeHookSpecificOutputSchemas,
>(key: Key, value: unknown): value is z.input<(typeof claudeHookSpecificOutputSchemas)[Key]> {
  return claudeHookSpecificOutputSchemas[key].safeParse(value).success;
}

/** Check an input for one key in {@link claudeSessionStateRecordSchemas}. */
export function isClaudeSessionStateRecordFor<
  Key extends keyof typeof claudeSessionStateRecordSchemas,
>(key: Key, value: unknown): value is z.input<(typeof claudeSessionStateRecordSchemas)[Key]> {
  return claudeSessionStateRecordSchemas[key].safeParse(value).success;
}

/** Check an input for one key in {@link claudeSessionSystemRecordSchemas}. */
export function isClaudeSessionSystemRecordFor<
  Key extends keyof typeof claudeSessionSystemRecordSchemas,
>(key: Key, value: unknown): value is z.input<(typeof claudeSessionSystemRecordSchemas)[Key]> {
  return claudeSessionSystemRecordSchemas[key].safeParse(value).success;
}

/** Check an input for one key in {@link claudeWorkflowJournalRecordSchemas}. */
export function isClaudeWorkflowJournalRecordFor<
  Key extends keyof typeof claudeWorkflowJournalRecordSchemas,
>(key: Key, value: unknown): value is z.input<(typeof claudeWorkflowJournalRecordSchemas)[Key]> {
  return claudeWorkflowJournalRecordSchemas[key].safeParse(value).success;
}

/** Check an input for one key in {@link codexEventMessageSchemas}. */
export function isCodexEventMessageFor<Key extends keyof typeof codexEventMessageSchemas>(
  key: Key,
  value: unknown,
): value is z.input<(typeof codexEventMessageSchemas)[Key]> {
  return codexEventMessageSchemas[key].safeParse(value).success;
}
