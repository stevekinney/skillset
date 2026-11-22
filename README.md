# skillset

[Zod](https://zod.dev) schemas, type guards, and validators for the configuration and runtime formats of [Claude Code](https://code.claude.com/docs) and [OpenAI Codex](https://developers.openai.com/codex): skill and subagent frontmatter, MCP server entries, hook settings, hook payloads, session transcripts, and workflow scripts.

Pass the library text or parsed values and it returns diagnostics or typed data. Your application handles file I/O and runs the hooks. Each format has its own verification history. The [provider compatibility reference](.claude/skills/tool-format-reference/SKILL.md) records the versions, sources, and runtime probes behind those checks.

```bash
bun add @lostgradient/skillset   # or npm install @lostgradient/skillset
```

The package ships ESM for [Node.js](https://nodejs.org/) 22+ and [Bun](https://bun.sh/) 1.3+, with shared TypeScript declarations. The metadata validators also work in a browser with a bundler.

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

- `validateSkillMetadata(content, { target?, directoryName? })` takes the text of a `SKILL.md`, parses its YAML frontmatter with [js-yaml](https://github.com/nodeca/js-yaml)'s safe loader, and returns `{ valid, issues, frontmatter?, body }`. `target` picks the tool: `claude` (the default) checks against Claude Code's schema, where every field is optional and `name` defaults to the directory, and `codex` checks against Codex's, where `name` and `description` are required. Pass `directoryName` to also check that `name` matches the folder; when `name` is absent, the naming rules apply to the directory name, since that is what Claude Code uses.
- It reports a bad name (format, length, Windows device names), a missing, empty, or over-long description, hook fields Claude Code ignores, keys neither tool reads, and a file over 500 lines. It also flags anti-patterns the schema alone accepts: a vague name such as `helper`, a description written as "I" or "you", a `compatibility` over 500 characters, and non-string `metadata` values. For Claude it adds the Claude platform's rules (no `anthropic` or `claude` in the name, no XML tags in the description), `description` plus `when_to_use` past the 1,536-character listing limit, `disable-model-invocation: true` together with `user-invocable: false`, and an `agent` without `context: fork`.
- `validateSubagentMetadata(content, { fileName? })` does the same for a Claude Code subagent (`.claude/agents/<name>.md`): the subagent schema, the naming rules, inline `mcpServers` items Claude Code would drop, hook fields, unknown keys, and anti-patterns such as an empty system prompt, `permissionMode: bypassPermissions`, and a tool in both `tools` and `disallowedTools`. Pass `fileName` (without `.md`) to check that `name` matches it.
- Both return `valid: false` when any `Issue` has `error` severity and never throw for a bad file; warnings do not affect `valid`. A `MetadataValidation<Frontmatter>` carries `frontmatter` only when the block parsed and passed its schema. The options are typed `ValidateSkillMetadataOptions` and `ValidateSubagentMetadataOptions`, and `Target` is `'claude' | 'codex'`.
- A `---js` or `---coffee` fence is refused rather than run, and any other fence language except YAML and JSON is reported as unsupported.
- For a Codex subagent, parse the TOML in your application and pass the resulting object to `codexAgentSchema`.

## Configuration schemas

Each schema is exported with its inferred type (the same name without `Schema`):

- Skills: `claudeSkillFrontmatterSchema` and `codexSkillFrontmatterSchema` for SKILL.md frontmatter, and `openaiConfigurationSchema` for the `agents/openai.yaml` Codex reads beside it. Both skill schemas accept the [agentskills.io](https://agentskills.io) fields (`license`, `compatibility`, `metadata`, `allowed-tools`, `arguments`). Claude's normalizes its boolean spellings (`yes`, `on`, `1`) to real booleans.
- Subagents: `claudeAgentFrontmatterSchema` for a Claude Code subagent's frontmatter, and `codexAgentSchema` for a parsed Codex agent file (`.codex/agents/<name>.toml`). The Codex schema requires `name`, `description`, and `developer_instructions` and validates supported role fields, including `model_reasoning_summary` and the five known disable-only `features` flags. Other keys survive parsing as unknown values. The Claude schema accepts `autoCompactWindow` as an integer of at least 100,000 tokens.
- MCP servers: `claudeMcpServerSchema` for an entry in `.mcp.json` or `~/.claude.json`, `claudeAgentMcpServerSchema` for a subagent `mcpServers` item, and `codexMcpServerSchema` for a `[mcp_servers.<name>]` table, which validates stdio and HTTP transport fields. `oauth.token_endpoint_auth_method` accepts `client_secret_basic` or `client_secret_post` with `auth = "ema_auth"` and an OAuth client secret.
- Hooks: `claudeHookSettingsSchema` for a `hooks` block in settings.json or in skill and subagent frontmatter, and `codexHookSettingsSchema` for the `hooks` value in Codex's `hooks.json` or its `[hooks]` table in TOML. Claude command, HTTP, and MCP tool handlers accept `onFailure: continue` or `onFailure: block`.
- Codex tables: `codexSkillsSchema` and `codexToolsSchema` for the `[skills]` and `[tools]` tables.
- Effort: `claudeEffortSchema` for skill and subagent `effort` (a level or an integer budget), and `claudeSettingsEffortSchema` for settings.json `effortLevel`, which accepts fewer values.

## Standalone JSON Schemas

Use `@lostgradient/skillset/schemas/claude-code.json` and `@lostgradient/skillset/schemas/codex.json` with a [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) validator. Each file validates one session record at its root. To validate a configuration object or a hook payload, point your validator at the appropriate `$defs` entry, such as `#/$defs/claudeSkillFrontmatterSchema` or `#/$defs/codexHookInputSchemas.PreModelRequest`, with the whole file loaded so references resolve.

Standalone schemas describe the shapes of parsed values. For YAML frontmatter, normalization, or checks that involve multiple fields, use the library validators or Zod schemas. When starting from TOML, parse it to an object first. Both files include shared definitions where applicable. The workflow budget API contains functions and is available through `claudeWorkflowBudgetSchema`.

## Type guards

Each top-level schema has a matching type guard that narrows an `unknown`: `isClaudeSkillFrontmatter`, `isCodexSkillFrontmatter`, `isClaudeAgentFrontmatter`, `isCodexAgent`, `isOpenaiConfiguration`, `isClaudeMcpServer`, `isClaudeAgentMcpServer`, `isCodexMcpServer`, `isClaudeHookSettings`, `isCodexHookSettings`, `isCodexSkills`, `isCodexTools`, `isClaudeEffort`, and `isClaudeSettingsEffort`, plus the hook, session, and workflow guards below. Guards narrow to the schema's input type (`z.input`), because a few schemas convert values while parsing (skill booleans accept `"yes"`), so a value that passes a guard still has its original shape. Parse with the schema to get converted values. Each public schema also has a corresponding parsed output type. Public maps expose keyed types and `...For` guards. The installed-package check verifies each contract in Node and Bun.

## Subpath imports

The root entry point, `@lostgradient/skillset`, contains the library API. The three domain subpaths expose the same values and types for their respective areas. Other subpaths expose workflow globals, the manifest, or standalone schemas.

- `@lostgradient/skillset/hooks`: the hook payload schemas, `parse*`/`safeParse*` helpers, event names, type guards, and types.
- `@lostgradient/skillset/sessions`: the Claude Code and Codex session transcript schemas, JSONL parsers, constants, type guards, and types, plus the workflow journal records.
- `@lostgradient/skillset/workflows`: the workflow script schemas, `meta`/call/forbidden-API helpers, type guards, and types.
- `@lostgradient/skillset/workflow-globals` supplies ambient declarations for JavaScript workflow scripts. Add a triple-slash reference as shown below. The subpath also exports the `claudeWorkflowGlobalNames` array.
- `@lostgradient/skillset/package.json` exposes the package manifest. The [standalone schema files](#standalone-json-schemas) are available through their JSON subpaths.

```typescript
import { parseClaudeHookInput } from '@lostgradient/skillset/hooks';
```

A subpath and the root resolve to one copy of each schema, so a `ZodError` or `ClaudeSessionJsonlError` is the same class either way.

## Hook payloads

- `claudeHookInputSchema` and `codexHookInputSchema` (discriminated on `hook_event_name`) validate the JSON a hook receives on stdin; `claudeHookInputSchemas`/`codexHookInputSchemas` hold the per-event schemas keyed by event name. `parseClaudeHookInput(payload)`/`parseCodexHookInput(payload)` dispatch on `hook_event_name` and throw a `ZodError` on a mismatch; `safeParseClaudeHookInput`/`safeParseCodexHookInput` return a result instead.
- `claudeHookOutputOrAsyncSchema` (the union of `claudeHookOutputSchema` and `claudeAsyncHookOutputSchema`) and `codexHookOutputSchemas` (keyed by event) describe what a hook may print to stdout; `parseClaudeHookOutput(payload)` and `parseCodexHookOutput(eventName, payload)` validate it, and `safeParseClaudeHookOutput`/`safeParseCodexHookOutput` return a result instead. `claudeHookEventNames`/`codexHookEventNames` list the events. The pieces they are built from are exported too: `claudeCommonHookInputSchema` (the fields every Claude Code event carries), `claudeHookSpecificOutputSchema` (the union of the 22 variants), `claudeHookOutputOrAsyncSchema` (the output union `isClaudeHookOutput` checks), `claudePermissionUpdateSchema` (a permission rule update in a `PermissionRequest` payload or decision), and `claudeStopFailureErrors` (the values of `StopFailure.error`).
- Type guards: `isClaudeHookInput`, `isClaudeHookOutput`, and `isCodexHookInput` check a whole payload. The per-event guards `isClaudeHookInputFor(eventName, value)`, `isCodexHookInputFor(eventName, value)`, and `isCodexHookOutputFor(eventName, value)` narrow to that event's shape.
- The provider input objects and Claude output objects preserve extra keys where their schemas are loose. Events whose stdout Codex reads use strict object schemas. Use the [Codex hooks reference](https://developers.openai.com/codex/hooks) for runtime rules outside structural validation, such as a non-empty reason for `block` or `updatedInput` for a PreToolUse `allow`. `tool_input` and `tool_response` stay `unknown` because their shape depends on the tool.
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

### Codex model-request hooks

Use `CodexHookInputFor<'PreModelRequest'>` or `CodexHookInputFor<'PostModelRequest'>` to work with one event. Both carry `request_id`, `thread_id`, `attempt_number`, and a `kind` of `sampling`, `foreground_compaction`, or `background_compaction`. The post event adds `status`, nullable `response_id` and `error`, and nullable `token_usage`.

Codex ignores command stdout for both model-request events and `SessionEnd`. For a synchronous `PostModelRequest` MCP tool hook, validate the tool result's `structuredContent` separately with `codexPostModelRequestMcpStructuredContentSchema`, `CodexPostModelRequestMcpStructuredContent`, or `isCodexPostModelRequestMcpStructuredContent`. The optional `extra_codex_rollout_budget_units` field must be nonnegative.

### Claude output guards

Use `isClaudeHookOutput` or `isClaudeHookOutputOrAsync` to accept either output form. Use `isClaudeSyncHookOutput` for the synchronous form and `isClaudeAsyncHookOutput` for the async form. Use `isClaudeHookSpecificOutput` for the nested `hookSpecificOutput` value or `isClaudeHookSpecificOutputFor(event, value)` to narrow it to `ClaudeHookSpecificOutputFor<Event>`. The `claudeHookSpecificOutputSchemas` map provides the individual Zod schemas by event. The shared pieces also have dedicated guards, `isClaudeCommonHookInput` and `isClaudePermissionUpdate`.

## Session transcripts

- **Claude Code** stores each session as JSONL under `~/.claude/projects/<project>/`, including the transcripts its subagents and workflows write under `<session-id>/subagents/`. `claudeSessionRecordSchema` validates one line: a union of every record type, with a per-type map in `claudeSessionRecordSchemas` and the names in `claudeSessionRecordTypeNames`. `parseClaudeSessionRecord`/`safeParseClaudeSessionRecord` check one record, and `parseClaudeSessionJsonl`/`safeParseClaudeSessionJsonl` check a whole file and report the failing line number. A workflow's `journal.jsonl` holds different records, which `claudeWorkflowJournalRecordSchema` covers (per-type schemas in `claudeWorkflowJournalRecordSchemas`, checked with `parseClaudeWorkflowJournalRecord`/`safeParseClaudeWorkflowJournalRecord`). `parseClaudeSessionJsonl` throws a `ClaudeSessionJsonlError` carrying every failing line.
- The record and message schemas that make up the union are exported on their own: `claudeSessionUserRecordSchema`, `claudeSessionAssistantRecordSchema`, `claudeSessionAttachmentRecordSchema`, `claudeSessionSystemRecordSchema`, `claudeSessionUserMessageSchema`, `claudeSessionAssistantMessageSchema`, `claudeSessionUserContentBlockSchema`, `claudeSessionAssistantContentBlockSchema`, `claudeSessionAttachmentSchema`, `claudeSessionToolUseResultSchema`, and `claudeSessionUsageSchema`, plus the keyed maps `claudeSessionStateRecordSchemas` and `claudeSessionSystemRecordSchemas`. Each standalone schema has an inferred type of the same name without `Schema`. The two maps expose `ClaudeSessionStateRecordFor` and `ClaudeSessionSystemRecordFor` for specific keys.
- Closed value sets are exported as constants: `claudeSessionAgentColors`, `claudeSessionApiErrors`, `claudeSessionEffortLevels`, `claudeSessionEntrypoints`, `claudeSessionPermissionModes`, `claudeSessionStopReasons`, `claudeSessionToolDenialKinds`, and `claudeSessionServerToolNames`. `claudeSessionUnobservedAttachmentTypes` and `claudeSessionUnobservedSystemSubtypes` list the attachment types and system subtypes Claude Code can write but that appear in no checked session; those are accepted by their tag alone, with no field checks.
- **Codex** stores each session as a JSONL rollout under `~/.codex/sessions/` and `~/.codex/archived_sessions/`. Each line is `{timestamp, type, payload}`. `codexSessionRecordSchema` validates one line, and `codexSessionRecordSchemas`, `codexResponseItemSchema`, `codexEventMessageSchemas`, and `codexTurnItemSchema` expose the nested shapes. `codexSessionRecordTypes`, `codexResponseItemTypes`, and `codexEventMessageTypes` list the values of the `type` tags, and `codexEventMessageSchema`, `codexSessionMetaPayloadSchema`, `codexTurnContextPayloadSchema`, and `codexCompactedPayloadSchema` are the payload schemas for the `event_msg`, `session_meta`, `turn_context`, and `compacted` records. The parse helpers are `parseCodexSessionRecord`, `safeParseCodexSessionRecord`, `parseCodexSessionJsonl` (which throws a `CodexSessionJsonlError`), and `safeParseCodexSessionJsonl`.
- Type guards: `isClaudeSessionRecord`, `isClaudeWorkflowJournalRecord`, and `isCodexSessionRecord` check one record, and `isClaudeSessionRecordFor(type, value)` and `isCodexSessionRecordFor(type, value)` narrow to one record type.
- Fields with a closed set of values are literal unions. A few Codex fields can hold values beyond the known list (`reasoning_effort`, for example), so their type keeps the known values for autocomplete and still accepts any other string. Loose record objects preserve unmodeled keys. A new discriminator or incompatible value can still fail validation. The handful of spots modeled as `unknown`, such as a tool's input, are listed with reasons in each module's comment.
- The [compatibility reference](.claude/skills/tool-format-reference/SKILL.md) records the session fixtures used for provider verification. The [development commands](#development) can check your local transcripts.

### Reading JSONL

The readers take text containing one JSON record per line. Both skip blank lines and keep their original positions in line numbers. `safeParseClaudeSessionJsonl(text)` returns `{ records, failures }`, collecting successful records and every failure. `safeParseCodexSessionJsonl(text)` stops at the first failure and returns either `{ success: true, records }` or `{ success: false, lineNumber, error }`. The throwing forms use `ClaudeSessionJsonlError.failures` and `CodexSessionJsonlError.lineNumber` respectively.

- Session exports also include `codexDynamicToolsUpdatedPayloadSchema`, `isClaudeSessionAssistantContentBlock`, `isClaudeSessionAssistantMessage`, `isClaudeSessionAssistantRecord`, `isClaudeSessionAttachment`, `isClaudeSessionAttachmentRecord`, `isClaudeSessionStateRecordFor`, `isClaudeSessionSystemRecord`, `isClaudeSessionSystemRecordFor`, `isClaudeSessionToolUseResult`, `isClaudeSessionUsage`, `isClaudeSessionUserContentBlock`, `isClaudeSessionUserMessage`, `isClaudeSessionUserRecord`, `isCodexCompactedPayload`, `isCodexDynamicToolsUpdatedPayload`, `isCodexEventMessage`, `isCodexEventMessageFor`, `isCodexResponseItem`, `isCodexSessionMetaPayload`, `isCodexTurnContextPayload`, `isCodexTurnItem`, `ClaudeSessionStateRecordFor`, `ClaudeSessionSystemRecordFor`, `CodexDynamicToolsUpdatedPayload`.

## Workflow scripts

- A workflow is a JavaScript file that begins with `export const meta = {...}` and orchestrates subagents through the globals `agent`, `pipeline`, `parallel`, `phase`, `log`, `workflow`, `args`, and `budget`. The schemas cover the script API, tool payloads, and stored run data described below.
- `claudeWorkflowMetaSchema` (and `claudeWorkflowPhaseSchema`) validate the evaluated `meta` block. `claudeWorkflowAgentOptionsSchema` validates the second argument of `agent()`: `effort` is `'low' | 'medium' | 'high' | 'xhigh' | 'max'`, `isolation` is `'worktree'`, and `claudeWorkflowOutputSchemaSchema` checks the `schema` option the way the runtime does (an object root with `properties`, and a `required` key outside `properties` only rejected when `additionalProperties` is `false`, the one contradiction the runtime proves). `claudeWorkflowToolInputSchema` and `claudeWorkflowToolOutputSchema` cover the `Workflow` tool, `claudeWorkflowReferenceSchema` covers the argument of `workflow()`, `claudeWorkflowBudgetSchema` covers `budget`, and `claudeWorkflowRunRecordSchema` covers the `wf_<id>.json` file Claude Code writes when a run ends. A run's `journal.jsonl` stays under `claudeWorkflowJournalRecordSchema`. `claudeWorkflowEffortSchema` and `claudeWorkflowIsolationSchema` are the two enums inside the `agent()` options, `claudeWorkflowRunIdSchema` checks a `wf_<id>` run id, `claudeWorkflowProgressRowSchema` (with `claudeWorkflowProgressPhaseSchema` and `claudeWorkflowProgressAgentSchema`) covers one row of a run record's progress, and `claudeWorkflowReservedMetaKeys` lists the keys the runtime refuses in `meta`. The runtime's limits are exported as `claudeWorkflowMaximumScriptBytes`, `claudeWorkflowMaximumItems`, `claudeWorkflowMaximumAgents`, and `claudeWorkflowDefaultConcurrency(cpus)`.
- `parseClaudeWorkflowMeta(source)` reads a script's `meta` from its source text with the same parser ([acorn](https://github.com/acornjs/acorn)) and rules as Claude Code: it must be the first statement and a pure literal, with no variables, calls, spreads, computed keys, or template interpolation. It returns the validated `meta` and the script body, or an error with a line number. `findClaudeWorkflowForbiddenApis(source)` finds `Date.now`, `Math.random`, and `new Date()` with no arguments, which throw inside a script. `extractClaudeWorkflowCalls(source)` evaluates the options of every `agent()` call written as a literal (or as a top-level `const` holding one), the references passed to `workflow()`, and the titles passed to `phase()`; what depends on a runtime value is counted rather than guessed. `checkClaudeWorkflowPhases(uses, titles)` compares those titles with `meta.phases`.
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
- One recorded corpus check covered 56 executed scripts, 14 helper files that were never run, 264 run records, 302 `Workflow` tool calls and 295 results in 121 session transcripts, and 503 `agent()` option objects. Claude Code's verdict on each of the 52 inline scripts (accepted or rejected) matched the verdict of `parseClaudeWorkflowMeta` and `findClaudeWorkflowForbiddenApis` every time (those checks cover the script's `meta`, syntax, and forbidden API calls). `bun run check:workflows` reruns the check against your own workflows. It reports counts, schema issue paths, and file:line locations, never script content.
- `agent()` also reads `disallowedTools`, `bashCommandClamp`, and `stallMs`, which the documented API does not mention; the options schema accepts them but treat them as unstable. In that corpus review, `agent(prompt, { isolation: 'remote' })` parsed and then threw at runtime. The options schema rejects it.

- Workflow exports also include `isClaudeWorkflowEffort`, `isClaudeWorkflowIsolation`, `isClaudeWorkflowJournalRecordFor`, `isClaudeWorkflowPhase`, `isClaudeWorkflowProgressAgent`, `isClaudeWorkflowProgressPhase`, `isClaudeWorkflowProgressRow`, `isClaudeWorkflowRunId`.

## Other types

- Hooks: `ClaudeHookEventName` and `CodexHookEventName` are the unions of event names, and `CodexHookOutput` is the union of every Codex event's output (`CodexHookOutputFor<'Stop'>` narrows it).
- Session transcripts: `ClaudeSessionRecordType` and `CodexSessionRecordType` are the `type` tags, and `ClaudeSessionRecordFor<'user'>`, `CodexSessionRecordFor<'turn_context'>`, `CodexSessionPayloadFor`, `CodexResponseItemType`, `CodexResponseItemFor`, `CodexEventMessageFor`, and `ClaudeWorkflowJournalRecordFor` narrow a record or payload to one tag. `ClaudeSessionJsonlResult`/`ClaudeSessionJsonlFailure` and `CodexSessionJsonlResult` are what the `safeParse...Jsonl` helpers return.
- Workflow scripts: `ClaudeWorkflowMetaResult` is what `parseClaudeWorkflowMeta` returns. `ClaudeWorkflowForbiddenApi` and `ClaudeWorkflowForbiddenApiResult` come from `findClaudeWorkflowForbiddenApis`. `ClaudeWorkflowCalls` is what `extractClaudeWorkflowCalls` returns, built from `ClaudeWorkflowCallSite`, `ClaudeWorkflowAgentCall`, `ClaudeWorkflowReferenceCall`, and `ClaudeWorkflowPhaseUse`; `ClaudeWorkflowPhaseCheck` is the result of `checkClaudeWorkflowPhases`.

## Releases

The [release workflow](.github/workflows/release.yaml) starts when you push a `vX.Y.Z` tag. It checks that the tag matches `package.json`, runs `bun run validate`, publishes to [npm](https://www.npmjs.com/package/@lostgradient/skillset) through trusted publishing with signed provenance, and creates a GitHub release. Verify that the exact version installs from npm after the workflow passes.

## Development

Use the [CI toolchain](.github/workflows/ci.yaml) for local verification. Install with `bun install --frozen-lockfile`, run `bun run check` for formatting, lint, and source type checking, or run `bun run validate` for the full gate including tests, builds, and packed consumer checks. See the [contributor guide](CLAUDE.md) for the build and Git hooks.

| Command                                                           | What it checks                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run scripts/check-provider-drift.ts`                         | Compares published provider artifacts with pinned baselines. Use `--all` for every finding, `--json` for structured output, or `--help` for exact-version replay. Start with _Needs work_.                                                                                             |
| `bun run scripts/claude-mod-types.ts v2.1.330 > claude-code.d.ts` | Fetches the ambient Claude Code Mod declarations for that release to stdout. Run from a checkout. Claude Code supplies [runtime-generated declarations](https://code.claude.com/docs/en/plugins/mods/create#get-type-definitions-for-your-version) for installed tools and connectors. |
| `bun run check:claude-sessions --root <directory>`                | Checks Claude transcripts and workflow journals. The default is `~/.claude/projects`. Use `--all-strings` to include the list of open string fields.                                                                                                                                   |
| `bun run check:codex-sessions --root <directory>`                 | Checks Codex rollouts. Repeat `--root` to scan multiple roots. The defaults are `~/.codex/sessions` and `~/.codex/archived_sessions` when present. Use `--jobs N` to set worker count or `--stride K` to check every Kth file.                                                         |
| `bun run check:workflows --root <directory>`                      | Checks Claude workflow sources, run records, and transcript calls. Repeat `--root` for project search roots. The script also scans the active Claude configuration directory. Use `--all` to show every reported location.                                                             |

Run the shared [`maintain-provider-compatibility` skill](.agents/skills/maintain-provider-compatibility/SKILL.md) to take a drift finding through verification, implementation, and reconciliation.
