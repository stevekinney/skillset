# skillset

Zod schemas, type guards, and validators for the configuration and runtime formats of [Claude Code](https://code.claude.com/docs) and [OpenAI Codex](https://developers.openai.com/codex): skill and subagent frontmatter, MCP server entries, hook settings, hook payloads, session transcripts, and workflow scripts.

Every schema is checked against what the tools themselves accept (their binaries, published schemas, and docs, as of Claude Code 2.1.288 and codex-cli 0.160), and the transcript and workflow schemas were checked against real sessions. Validation is pure: nothing here reads or writes files, and nothing runs at import.

```bash
bun add @lostgradient/skillset   # or npm install @lostgradient/skillset
```

The package is ESM, dual-published for Node and Bun (`dist/node/`, `dist/bun/`) with shared types.

## Validating a skill or subagent

```typescript
import { readFile } from 'node:fs/promises';
import { validateSkillMetadata } from '@lostgradient/skillset';

const result = validateSkillMetadata(await readFile('skills/pdf/SKILL.md', 'utf8'), {
  directoryName: 'pdf',
});

if (!result.valid) {
  for (const issue of result.issues) console.error(`${issue.severity}: ${issue.message}`);
}
```

- `validateSkillMetadata(content, { target?, directoryName? })` takes the text of a `SKILL.md`, parses its frontmatter with [gray-matter](https://github.com/jonschlinkert/gray-matter), and returns `{ valid, issues, frontmatter?, body }`. `target` picks the tool: `claude` (the default) checks against Claude Code's schema, where every field is optional and `name` defaults to the directory, and `codex` checks against Codex's, where `name` and `description` are required. Pass `directoryName` to also check that `name` matches the folder.
- It reports a bad name (format, length, reserved words, Windows device names), a missing, empty, over-long, or tagged description, hook fields Claude Code ignores, keys neither tool reads, and a file over 500 lines. It also flags anti-patterns the schema alone accepts: a vague name such as `helper`, a description written as "I" or "you", a `compatibility` over 500 characters, and non-string `metadata` values. For Claude it adds `description` plus `when_to_use` past the 1,536-character listing limit, `disable-model-invocation: true` together with `user-invocable: false`, and an `agent` without `context: fork`.
- `validateSubagentMetadata(content, { fileName? })` does the same for a Claude Code subagent (`.claude/agents/<name>.md`): the subagent schema, the naming rules, inline `mcpServers` items Claude Code would drop, hook fields, unknown keys, and anti-patterns such as an empty system prompt, `permissionMode: bypassPermissions`, and a tool in both `tools` and `disallowedTools`. Pass `fileName` (without `.md`) to check that `name` matches it.
- Both return `valid: false` when any `Issue` has `error` severity and never throw for a bad file; warnings do not affect `valid`. A `MetadataValidation<Frontmatter>` carries `frontmatter` only when the block parsed and passed its schema. The options are typed `ValidateSkillMetadataOptions` and `ValidateSubagentMetadataOptions`, and `Target` is `'claude' | 'codex'`.
- gray-matter would `eval` a `---js` or `---coffee` block, so both functions refuse one instead.

## Configuration schemas

Each schema is exported with its inferred type (the same name without `Schema`):

- Skills: `claudeSkillFrontmatterSchema` and `codexSkillFrontmatterSchema` for SKILL.md frontmatter, and `openaiConfigurationSchema` for the `agents/openai.yaml` Codex reads beside it. Both skill schemas accept the agentskills.io fields (`license`, `compatibility`, `metadata`, `allowed-tools`, `arguments`). Claude's normalizes its boolean spellings (`yes`, `on`, `1`) to real booleans.
- Subagents: `claudeAgentFrontmatterSchema` for a Claude Code subagent's frontmatter, and `codexAgentSchema` for a parsed Codex agent file (`.codex/agents/<name>.toml`). The Codex schema requires `name`, `description`, and `developer_instructions` and keeps any other `config.toml` key, as Codex does. Parse the TOML yourself.
- MCP servers: `claudeMcpServerSchema` for an entry in `.mcp.json` or `~/.claude.json`, `claudeAgentMcpServerSchema` for a subagent `mcpServers` item, and `codexMcpServerSchema` for a `[mcp_servers.<name>]` table, which enforces Codex's transport rules (no `url` with `command`, and so on).
- Hooks: `claudeHookSettingsSchema` for a `hooks` block in settings.json or in skill and subagent frontmatter, and `codexHookSettingsSchema` for Codex's `hooks.json` or `[hooks]` table.
- Codex tables: `codexSkillsSchema` and `codexToolsSchema` for the `[skills]` and `[tools]` tables.
- Effort: `claudeEffortSchema` for skill and subagent `effort` (a level or an integer budget), and `claudeSettingsEffortSchema` for settings.json `effortLevel`, which accepts fewer values.

## Type guards

Each top-level schema has a matching type guard that narrows an `unknown`: `isClaudeSkillFrontmatter`, `isCodexSkillFrontmatter`, `isClaudeAgentFrontmatter`, `isCodexAgent`, `isOpenaiConfiguration`, `isClaudeMcpServer`, `isClaudeAgentMcpServer`, `isCodexMcpServer`, `isClaudeHookSettings`, `isCodexHookSettings`, `isCodexSkills`, `isCodexTools`, `isClaudeEffort`, and `isClaudeSettingsEffort`, plus the hook, session, and workflow guards below. Guards narrow to the schema's input type (`z.input`), because a few schemas convert values while parsing (skill booleans accept `"yes"`), so a value that passes a guard still has its original shape. Parse with the schema to get converted values. Nested building-block schemas (one record type, one content block) have no guard of their own; use the `...For` guard of the union they belong to.

## Subpath imports

The root exports everything. Three subpaths export just their own part of it, with the same values and types, for code that only needs one area:

- `@lostgradient/skillset/hooks`: the hook payload schemas, `parse*`/`safeParse*` helpers, event names, type guards, and types.
- `@lostgradient/skillset/sessions`: the Claude Code and Codex session transcript schemas, JSONL parsers, constants, type guards, and types, plus the workflow journal records.
- `@lostgradient/skillset/workflows`: the workflow script schemas, `meta`/call/forbidden-API helpers, type guards, and types.
- `@lostgradient/skillset/workflow-globals` is a separate, types-only entry point for type-checking workflow scripts (see below).

```typescript
import { parseClaudeHookInput } from '@lostgradient/skillset/hooks';
```

A subpath and the root resolve to one copy of each schema, so a `ZodError` or `ClaudeSessionJsonlError` is the same class either way.

## Hook payloads

- `claudeHookInputSchema` (33 events, discriminated on `hook_event_name`) and `codexHookInputSchema` (12 events) validate the JSON a hook receives on stdin; `claudeHookInputSchemas`/`codexHookInputSchemas` hold the per-event schemas keyed by event name. `parseClaudeHookInput(payload)`/`parseCodexHookInput(payload)` dispatch on `hook_event_name` and throw a `ZodError` on a mismatch; `safeParseClaudeHookInput`/`safeParseCodexHookInput` return a result instead.
- `claudeHookOutputSchema` (with its 22 `claudeHookSpecificOutputSchemas` variants and the `claudeAsyncHookOutputSchema` async form) and `codexHookOutputSchemas` (keyed by event) describe what a hook may print to stdout; `parseClaudeHookOutput(payload)` and `parseCodexHookOutput(eventName, payload)` validate it, and `safeParseClaudeHookOutput`/`safeParseCodexHookOutput` return a result instead. `claudeHookEventNames`/`codexHookEventNames` list the events. The pieces they are built from are exported too: `claudeCommonHookInputSchema` (the fields every Claude Code event carries), `claudeHookSpecificOutputSchema` (the union of the 22 variants), `claudeHookOutputOrAsyncSchema` (the output union `isClaudeHookOutput` checks), `claudePermissionUpdateSchema` (a permission rule update in a `PermissionRequest` payload or decision), and `claudeStopFailureErrors` (the values of `StopFailure.error`).
- Type guards: `isClaudeHookInput`, `isClaudeHookOutput`, and `isCodexHookInput` check a whole payload. The per-event guards `isClaudeHookInputFor(eventName, value)`, `isCodexHookInputFor(eventName, value)`, and `isCodexHookOutputFor(eventName, value)` narrow to that event's shape.
- Input and Claude output schemas are `z.looseObject`, so a field a newer Claude Code or Codex adds never fails a parse and survives into the parsed value. Codex output schemas are strict, because Codex marks a hook run Failed when stdout carries an unknown key. Rules the schemas cannot express (a Codex `block` needs a non-empty `reason`, PreToolUse `allow` needs `updatedInput`) are not enforced; see the Codex hooks docs. `tool_input` and `tool_response` stay `unknown` because their shape depends on the tool.
- Types: `ClaudeCommonHookInput`, `ClaudeHookSpecificOutput`, `ClaudeHookOutputOrAsync`, `ClaudeHookInput`, `ClaudeHookInputFor<'Stop'>`, `ClaudeHookOutput`, `CodexHookInput`, `CodexHookInputFor<'Stop'>`, `CodexHookOutputFor<'Stop'>`, and the event name unions.

```typescript
import { parseClaudeHookInput, type ClaudeHookOutput } from '@lostgradient/skillset';

const input = parseClaudeHookInput(JSON.parse(await Bun.stdin.text()));

if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'Bash') {
  const output: ClaudeHookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Shell access is disabled in this repository.',
    },
  };
  console.log(JSON.stringify(output));
}
```

## Session transcripts

- **Claude Code** stores each session as JSONL under `~/.claude/projects/<project>/`, including the transcripts its subagents and workflows write under `<session-id>/subagents/`. `claudeSessionRecordSchema` validates one line: a union of every record type, with a per-type map in `claudeSessionRecordSchemas` and the names in `claudeSessionRecordTypeNames`. `parseClaudeSessionRecord`/`safeParseClaudeSessionRecord` check one record, and `parseClaudeSessionJsonl`/`safeParseClaudeSessionJsonl` check a whole file and report the failing line number. A workflow's `journal.jsonl` holds different records, which `claudeWorkflowJournalRecordSchema` covers (per-type schemas in `claudeWorkflowJournalRecordSchemas`, checked with `parseClaudeWorkflowJournalRecord`/`safeParseClaudeWorkflowJournalRecord`). `parseClaudeSessionJsonl` throws a `ClaudeSessionJsonlError` carrying every failing line.
- The record and message schemas that make up the union are exported on their own: `claudeSessionUserRecordSchema`, `claudeSessionAssistantRecordSchema`, `claudeSessionAttachmentRecordSchema`, `claudeSessionSystemRecordSchema`, `claudeSessionUserMessageSchema`, `claudeSessionAssistantMessageSchema`, `claudeSessionUserContentBlockSchema`, `claudeSessionAssistantContentBlockSchema`, `claudeSessionAttachmentSchema`, `claudeSessionToolUseResultSchema`, and `claudeSessionUsageSchema`, plus the keyed maps `claudeSessionStateRecordSchemas` and `claudeSessionSystemRecordSchemas`. Each has an inferred type of the same name without `Schema`.
- Closed value sets are exported as constants: `claudeSessionAgentColors`, `claudeSessionApiErrors`, `claudeSessionEffortLevels`, `claudeSessionEntrypoints`, `claudeSessionPermissionModes`, `claudeSessionStopReasons`, `claudeSessionToolDenialKinds`, and `claudeSessionServerToolNames`. `claudeSessionUnobservedAttachmentTypes` and `claudeSessionUnobservedSystemSubtypes` list the attachment types and system subtypes Claude Code can write but that appear in no checked session; those are accepted by their tag alone, with no field checks.
- **Codex** stores each session as a JSONL rollout under `~/.codex/sessions/` and `~/.codex/archived_sessions/`. Each line is `{timestamp, type, payload}`. `codexSessionRecordSchema` validates one line, and `codexSessionRecordSchemas`, `codexResponseItemSchema`, `codexEventMessageSchemas`, and `codexTurnItemSchema` expose the nested shapes. `codexSessionRecordTypes`, `codexResponseItemTypes`, and `codexEventMessageTypes` list the values of the `type` tags, and `codexEventMessageSchema`, `codexSessionMetaPayloadSchema`, `codexTurnContextPayloadSchema`, and `codexCompactedPayloadSchema` are the payload schemas for the `event_msg`, `session_meta`, `turn_context`, and `compacted` records. The parse helpers are `parseCodexSessionRecord`, `safeParseCodexSessionRecord`, `parseCodexSessionJsonl` (which throws a `CodexSessionJsonlError`), and `safeParseCodexSessionJsonl`.
- Type guards: `isClaudeSessionRecord`, `isClaudeWorkflowJournalRecord`, and `isCodexSessionRecord` check one record, and `isClaudeSessionRecordFor(type, value)` and `isCodexSessionRecordFor(type, value)` narrow to one record type.
- Fields with a closed set of values are literal unions. A few Codex fields can hold values beyond the known list (`reasoning_effort`, for example), so their type keeps the known values for autocomplete and still accepts any other string. Records are loose objects, so a field a newer version adds never fails a parse. The handful of spots modeled as `unknown`, such as a tool's input, are listed with reasons in each module's comment.
- The schemas were checked against every session file on the development machine: 4,140 Claude Code files (1.1 million records, versions 2.1.221 through 2.1.289) and 10,102 Codex files (4.9 million records). `bun run check:claude-sessions` and `bun run check:codex-sessions` rerun those checks against your own sessions. They report parse failures and fields the schema doesn't model, but never record content.

## Workflow scripts

- A workflow is a JavaScript file that begins with `export const meta = {...}` and orchestrates subagents through the globals `agent`, `pipeline`, `parallel`, `phase`, `log`, `workflow`, `args`, and `budget`. These schemas and helpers describe every structure Claude Code reads or writes for one.
- `claudeWorkflowMetaSchema` (and `claudeWorkflowPhaseSchema`) validate the evaluated `meta` block. `claudeWorkflowAgentOptionsSchema` validates the second argument of `agent()`: `effort` is `'low' | 'medium' | 'high' | 'xhigh' | 'max'`, `isolation` is `'worktree'`, and `claudeWorkflowOutputSchemaSchema` checks the `schema` option the way the runtime does (an object root with `properties`, and a `required` key outside `properties` only rejected when `additionalProperties` is `false`, the one contradiction the runtime proves). `claudeWorkflowToolInputSchema` and `claudeWorkflowToolOutputSchema` cover the `Workflow` tool, `claudeWorkflowReferenceSchema` covers the argument of `workflow()`, `claudeWorkflowBudgetSchema` covers `budget`, and `claudeWorkflowRunRecordSchema` covers the `wf_<id>.json` file Claude Code writes when a run ends. A run's `journal.jsonl` stays under `claudeWorkflowJournalRecordSchema`. `claudeWorkflowEffortSchema` and `claudeWorkflowIsolationSchema` are the two enums inside the `agent()` options, `claudeWorkflowRunIdSchema` checks a `wf_<id>` run id, `claudeWorkflowProgressRowSchema` (with `claudeWorkflowProgressPhaseSchema` and `claudeWorkflowProgressAgentSchema`) covers one row of a run record's progress, and `claudeWorkflowReservedMetaKeys` lists the keys the runtime refuses in `meta`. The runtime's limits are exported as `claudeWorkflowMaximumScriptBytes`, `claudeWorkflowMaximumItems`, `claudeWorkflowMaximumAgents`, and `claudeWorkflowDefaultConcurrency(cpus)`.
- `parseClaudeWorkflowMeta(source)` reads a script's `meta` from its source text with the same parser (acorn) and rules as Claude Code: it must be the first statement and a pure literal, with no variables, calls, spreads, computed keys, or template interpolation. It returns the validated `meta` and the script body, or an error with a line number. `findClaudeWorkflowForbiddenApis(source)` finds `Date.now`, `Math.random`, and `new Date()` with no arguments, which throw inside a script. `extractClaudeWorkflowCalls(source)` evaluates the options of every `agent()` call written as a literal (or as a top-level `const` holding one), the references passed to `workflow()`, and the titles passed to `phase()`; what depends on a runtime value is counted rather than guessed. `checkClaudeWorkflowPhases(uses, titles)` compares those titles with `meta.phases`.
- Type guards: `isClaudeWorkflowMeta`, `isClaudeWorkflowAgentOptions`, `isClaudeWorkflowOutputSchema`, `isClaudeWorkflowToolInput`, `isClaudeWorkflowToolOutput`, `isClaudeWorkflowReference`, `isClaudeWorkflowBudget`, and `isClaudeWorkflowRunRecord`.
- To type-check a script, reference the globals from a JavaScript file and turn on `// @ts-check`. The declarations live in a separate entry point, `@lostgradient/skillset/workflow-globals`, because importing them from the main entry would put `agent` and `pipeline` into every consumer's global scope.

```javascript
// @ts-check
/// <reference types="@lostgradient/skillset/workflow-globals" />
export const meta = { name: 'audit-routes', description: 'Audit every route handler' };

const found = await agent('List every route file.', {
  schema: {
    type: 'object',
    required: ['files'],
    properties: { files: { type: 'array', items: { type: 'string' } } },
  },
});
// `found` is typed from the schema: `{ files: string[] } | null`.
const audits = await pipeline(found?.files ?? [], (file) =>
  agent(`Audit ${file}`, { label: file }),
);
```

- `agent(prompt, { schema })` returns the object type the schema literal describes (`type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, and `oneOf` are understood; anything else is `unknown`), and `agent(prompt)` returns `string`, both `| null`. `pipeline` is typed through six stages, each receiving the previous stage's result, and `parallel` keeps a tuple's element types. `ClaudeWorkflowScriptGlobals` describes the whole environment, and the individual types (`ClaudeWorkflowAgent`, `ClaudeWorkflowAgentCallOptions`, `ClaudeWorkflowPipeline`, `ClaudeWorkflowPipelineStage`, `ClaudeWorkflowParallel`, `ClaudeWorkflowBudgetApi`, `ClaudeWorkflowSchemaObject`, `ClaudeWorkflowSchemaResult`, and the rest) are exported from the main entry.
- Two things TypeScript cannot be taught: a top-level `return` is valid in a workflow script but reported as an error (TS1108) in a module, so put `// @ts-ignore` above it, and `args` is typed `any`, because its shape comes from whoever launches the workflow. Set `"module": "esnext"`, `"moduleResolution": "bundler"`, and `"allowJs": true` with `"checkJs": true` in a `jsconfig.json` to check scripts without a per-file comment.
- The schemas and helpers were checked against every workflow on the development machine: 56 executed scripts, 14 helper files that were never run, 264 run records, 302 `Workflow` tool calls and 295 results in 121 session transcripts, and 503 `agent()` option objects. Claude Code's verdict on each of the 52 inline scripts (accepted or rejected) matched the verdict of `parseClaudeWorkflowMeta` and `findClaudeWorkflowForbiddenApis` every time (Claude Code refuses a script at launch for its `meta`, syntax, and use of those APIs, and nothing else). `bun run check:workflows` reruns the check against your own workflows. It reports counts, schema issue paths, and file:line locations, never script content.
- `agent()` also reads `disallowedTools`, `bashCommandClamp`, and `stallMs`, which the documented API does not mention; the options schema accepts them but treat them as unstable. `agent({ isolation: 'remote' })` parses but throws in the current build, so the schema rejects it.

## Other types

- Hooks: `ClaudeHookEventName` and `CodexHookEventName` are the unions of event names, and `CodexHookOutput` is the union of every Codex event's output (`CodexHookOutputFor<'Stop'>` narrows it).
- Session transcripts: `ClaudeSessionRecordType` and `CodexSessionRecordType` are the `type` tags, and `ClaudeSessionRecordFor<'user'>`, `CodexSessionRecordFor<'turn_context'>`, `CodexSessionPayloadFor`, `CodexResponseItemType`, `CodexResponseItemFor`, `CodexEventMessageFor`, and `ClaudeWorkflowJournalRecordFor` narrow a record or payload to one tag. `ClaudeSessionJsonlResult`/`ClaudeSessionJsonlFailure` and `CodexSessionJsonlResult` are what the `safeParse...Jsonl` helpers return.
- Workflow scripts: `ClaudeWorkflowMetaResult` is what `parseClaudeWorkflowMeta` returns. `ClaudeWorkflowForbiddenApi` and `ClaudeWorkflowForbiddenApiResult` come from `findClaudeWorkflowForbiddenApis`. `ClaudeWorkflowCalls` is what `extractClaudeWorkflowCalls` returns, built from `ClaudeWorkflowCallSite`, `ClaudeWorkflowAgentCall`, `ClaudeWorkflowReferenceCall`, and `ClaudeWorkflowPhaseUse`; `ClaudeWorkflowPhaseCheck` is the result of `checkClaudeWorkflowPhases`.

## Releases

Tag-driven (`v*.*.*`): the release workflow verifies the tag matches `package.json`, runs the full gate, publishes to npm with provenance, and creates a GitHub release.

## Development

```bash
bun test             # tests (100% coverage enforced for src/)
bun run validate     # full gate: format, lint, typecheck, tests, build, package checks
bun run check:claude-sessions   # check the session schemas against your own transcripts
bun run check:codex-sessions
bun run check:workflows
```

Git hooks (Lefthook) format and lint on commit and run the full `validate` gate on push; CI runs the same gate on every push and pull request. Published `src/` code must stay Node-compatible — Bun-only APIs belong in `scripts/` and tests.
