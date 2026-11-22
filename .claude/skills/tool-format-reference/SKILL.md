---
name: tool-format-reference
description: Verified reference for Claude Code and Codex CLI configuration surfaces (skills, agents, MCP, hooks) that this project's schemas encode. Consult before changing schemas or validation rules; update after every research pass.
---

# Verified tool-format reference

The notes below record provider behavior at the versions named in each section. Use [maintain-provider-compatibility](../../../.agents/skills/maintain-provider-compatibility/SKILL.md) to check a newer target or an uncovered surface.

## Review record

Start with the version cited next to each historical claim. Treat it as a starting point for that claim only. Once an entire surface has been reviewed, record its last reviewed tag per provider here, with source and probe evidence. Focused findings leave those tags unchanged.

The current library ships schemas, validators, and authoring references. November experiments involving `defaults.yaml`, `hooks.yaml`, sync, import, and plugin export used a separate CLI development snapshot. Those experiments establish provider behavior for the matching formats. See the [public API](../../../README.md) for the shipped library surface.

### 2026-11-21 focused findings

Run `bun run scripts/check-provider-drift.ts` for the machine-readable artifact comparison. The first run compared Codex `0.160.0` to `0.171.0`, Claude Code `2.1.288` to `2.1.330`, and Claude Agent SDK `0.3.288` to `0.3.330`. SchemaStore settings changed between commits `d2cbdcde9855c1bf9ea99c336163cc6c93753e39` and `bf7c6745505ccace5568dc0d7f4ae29647e9b41a`. These are comparison points. The review record above still applies.

- Codex changed its configuration and App Server schemas. Of 24 hook payload schemas, 23 were structurally unchanged and one was added. The new schema covers `PreModelRequest` and `PostModelRequest`. Both are now in Skillset's Codex configuration and payload registries. The pinned replay reported no missing Codex hook names. Codex 0.171.0 discovered both emitted hooks and dispatched them against a local mock provider. Skillset parsed both captured stdin payloads, and diagnostic stdout containing `continue: false` left the request running. [Model-request hook schema](https://raw.githubusercontent.com/openai/codex/rust-v0.171.0/codex-rs/hooks/schema/generated/model-request.command.input.schema.json)
- Claude Code's tagged Mod declarations added `PluginState`, `claude-code/shader`, and new agent and UI types. The published Agent SDK's declarations also changed. Every event in the `0.3.330` SDK's `HookEvent` union appeared in both Skillset registries. This verifies name coverage against the SDK. Classic shell-hook payload behavior still requires probes. [Mod declarations](https://github.com/anthropics/claude-code/blob/v2.1.330/mods/types/claude-code.d.ts), [Agent SDK declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.330/sdk.d.ts)
- SchemaStore added `skills-dir` marketplace variants for `blockedMarketplaces` and `strictKnownMarketplaces`, and widened the environment-variable name pattern to accept lowercase letters. [Pinned settings schema](https://github.com/SchemaStore/schemastore/blob/bf7c6745505ccace5568dc0d7f4ae29647e9b41a/src/schemas/json/claude-code-settings.json)

- The CLI development snapshot packaged one Claude Code Mod selected by `plugin.yaml`'s `claudeMod` field. It copied files from `claude-mod/`, wrote the module entry beside classic hooks, and added a manifest `types` path when `types/index.d.ts` was present. Claude Code 2.1.330 passed `claude plugin validate --strict` and `claude plugin test` on a Skillset export with a relative import, a declaration file, and a classic hook. For authoring, use Claude Code's generated declarations under `.claude-plugin/types/`. [Mods creation guide](https://code.claude.com/docs/en/plugins/mods/create), [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference)

### 2026-11-21 authoring and schema review

- Mod authors can fetch the public `claude-code` ambient declarations by stable release tag with `bun run scripts/claude-mod-types.ts <tag>`. The v2.1.330 output matched the upstream file byte for byte and type-checked a Mod using `Register`, including a negative check for an unknown event. Runtime-generated built-in tool and connector types come from Claude Code. [Published declarations](https://github.com/anthropics/claude-code/blob/v2.1.330/mods/types/claude-code.d.ts) · [Generated declarations](https://code.claude.com/docs/en/plugins/mods/create#get-type-definitions-for-your-version)
- The documented Claude skill frontmatter fields were already represented. Claude agent frontmatter now supports `autoCompactWindow` at the documented minimum of 100,000 tokens. The library's Codex role schema validates `model_reasoning_summary` and five disable-only feature overrides. Codex 0.171.0 still inherits sandbox policy, MCP servers, hooks, and tool tables from the parent. The tagged loader and request routing treat service tier separately. See the runtime review below. [Claude agent frontmatter](https://code.claude.com/docs/en/sub-agents#frontmatter-reference) · [Codex tagged role loader](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/agent/role.rs)
- Claude command, HTTP, and MCP tool hooks now validate `onFailure: continue|block`. The Agent SDK change is to callback configuration. Classic hook payloads are a separate surface. Codex synchronous `PostModelRequest` MCP structured content now has its own schema and type guard for the optional finite, nonnegative rollout-budget charge. [Claude failure behavior](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails) · [Codex post-hook implementation](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/hooks/src/events/model_request.rs)
- App Server RPC changes do not establish on-disk rollout schema changes. The SchemaStore marketplace variants and environment-variable name pattern are outside Skillset's current settings projections. The comparison pins still anchor those unreviewed contracts.

### 2026-11-21 runtime routing and rollout review

- Codex 0.171.0 `exec` sent the root's `flex` tier from both the parent and a child configured for `priority`. The observed child model identified the role independently of tier. The same result held for both multi-agent modes and the control role with no tier override. The role loader sets a local value, while controller-owned requests use the root controller's routing tier. The upstream tests also cover an embedded host without a shared tier provider, where a role tier can apply. The CLI development snapshot wrote a root tier from `defaults.yaml` into `config.toml`. A loopback run used that tier on both requests. [Codex CLI docs](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agent-file-schema) · [Tagged routing implementation](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/agent/host/service_tier.rs) · [Tagged runtime tests](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/tests/suite/subagent_service_tier.rs)
- The Codex MCP server OAuth contract adds `token_endpoint_auth_method`. Skillset validates its two values and requires EMA authentication and a client secret when the method is set. Native `codex mcp get` accepted the EMA configuration and rejected the same method under ordinary OAuth. The separate IdP OAuth settings and plugin host policy are outside the MCP server source projection. [Codex config schema](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/config.schema.json)
- Codex 0.171.0 rollouts include turn attribution and the completing event's root turn ID. Session metadata also defines `account_scoped` and `attached_thread`. The turn context deserializer accepts a permission profile or a legacy sandbox policy, with an optional summary. The tagged persistence policy also adds `dynamic_tools_updated` and persists `additional_tools` response items. Both are now typed. The strict corpus checker passed all 39 records from the synthetic parent and child rollouts with no parse failures or unmodeled fields. [Tagged on-disk protocol types](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/protocol.rs)
- The Claude Code 2.1.330 fixture confirmed existing support for the three `api-request*` records. A `session_context` attachment with an empty context exposed a required-email assumption. Skillset now accepts that record and types the assistant's reference to the persisted request and its model and cache metadata. The strict corpus checker passed all 22 fixture records with no parse failures or unmodeled fields, including cache patches and token counters. [Claude Code changelog](https://github.com/anthropics/claude-code/blob/v2.1.330/CHANGELOG.md)

### 2026-11-21 baseline reconciliation

The Codex generated hook payload baseline is now `rust-v0.171.0`. The model-request schema was its only structural addition, and both events passed the runtime probes above. The Codex configuration pin stays at `rust-v0.160.0`. Six exact configuration changes are recorded as reviewed, covering both model-request hook entries, the standalone EMA OAuth method and its enum, and the two plugin host-policy removals.

Codex 0.171.0 rejects `ema_auth` in plugin MCP declarations. The CLI development snapshot rejected those declarations at export and supported EMA auth when writing `config.toml`. The added top-level IdP OAuth fields are part of a separate settings surface. [Tagged plugin MCP parser and tests](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/codex-mcp/src/plugin_config_tests.rs)

The rerun preserved all 2,140 other structural findings. Open configuration changes include IdP OAuth, plugin policy and trust state. The App Server findings describe wire contracts. The Mod helper fetched the tagged declaration byte for byte, and the declaration audit still shows changes to the Mod API and SDK. SchemaStore still shows all three marketplace and environment changes. Hook event name parity remains green for Codex and the Claude SDK. The checker observed no artifact delta for the root `service_tier` or the session fixes above, which were verified separately against runtime and persistence contracts.

### 2026-11-21 Codex tools and Claude Mod state

- Codex 0.171.0 accepted `standalone` and `search_mcp` in root `tools.client_search_provider` through `codex mcp list --json` and rejected an invalid value. The library's `codexToolsSchema` accepts both values. The tagged role loader omits the tools table when it applies overrides. The accepted values establish configuration validity. Search routing was outside this probe. [Tagged configuration schema](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/config.schema.json) · [Tagged role loader](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/agent/role.rs)
- Claude Code 2.1.330 recognized the exported custom declaration path `./hooks/mod/contracts/state.d.ts` and found its named state field in `claude plugin validate --strict`. The fixture type-checked against the v2.1.330 public declarations, and `claude plugin test` read and wrote state through the exported Mod. The CLI experiment used `claudeModTypes` to select a relative declaration path. Its default was `types/index.d.ts`. Desktop and cloud behavior remain unverified. [Mods file reference](https://code.claude.com/docs/en/plugins/mods/reference#files) · [Tagged declarations](https://github.com/anthropics/claude-code/blob/v2.1.330/mods/types/claude-code.d.ts)
- The report records the exact Codex table field, its enum, and the Claude `PluginState` declaration as reviewed. The broad pins stay in place. Open Codex changes include host OAuth, plugin policy and trust state, and client features. The remaining Mod declaration changes include UI and testing APIs. Those APIs belong to the Mod runtime.

### 2026-11-21 Claude SDK and settings review

- Agent SDK 0.3.330 adds `AgentDefinition.autoCompactWindow`. The corresponding Claude Code agent frontmatter schema validates the documented minimum of 100,000 tokens. The SDK's hook event names are all present in the configuration and payload registries. The new SDK callback matcher field, initialization capability bit, and context-usage metadata remain open. Skillset does not own the SDK callback registration or wire protocol. [SDK declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.330/sdk.d.ts) · [Claude agent frontmatter](https://code.claude.com/docs/en/sub-agents#frontmatter-reference)
- In the CLI development snapshot, `hooks.yaml` accepted `onFailure` for Claude command, HTTP, and MCP tool handlers. The Claude override took precedence. A project sync followed by a Claude Code 2.1.330 loopback run with a failing command on `UserPromptSubmit` sent zero model requests with `block` and one with `continue`. This probe exercised the classic command handler. It did not exercise SDK callbacks or native HTTP and MCP hook failures. [Claude handler behavior](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails) · [SDK callback behavior](https://code.claude.com/docs/en/agent-sdk/hooks#block-the-action-when-a-callback-fails)
- SchemaStore accepts lowercase names in `settings.json`'s `env` map. The same native command hooks received a lowercase name from project settings after Skillset synced the hooks. The CLI development snapshot recognized lowercase environment references in MCP headers, stdio, and fallback detection. Codex 0.171.0 `mcp get --json` loaded the emitted bearer reference and header mapping with their original case. Both `skills-dir` marketplace changes remain open and are outside Skillset's settings projection. [Pinned SchemaStore settings](https://github.com/SchemaStore/schemastore/blob/bf7c6745505ccace5568dc0d7f4ae29647e9b41a/src/schemas/json/claude-code-settings.json)

### 2026-11-21 App Server and rollout overlap

The drift checker reads Codex App Server's published JSON-RPC schema. Skillset's session parser reads local rollout records. The tracked source has no App Server client. The RPC changes to account, hooks management, model providers, and thread operations stay open. App Server's new image generation fields also stay open because the tagged rollout `ImageGenerationItem` still requires `result`. [App Server protocol](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/app-server/README.md) · [Tagged rollout turn items](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/items.rs)

Two synthetic loopback runs with Codex CLI 0.171.0 wrote `partial_answer` to both response and completed turn records. The second also wrote file-backed audio. Both raw messages preserved the opaque `encrypted_content` string and the strict Skillset corpus check passed all 28 records with zero parse failures or unmodeled fields. Regression tests cover file-backed tool and user input audio, opaque response fields, MCP registration environment IDs, the science plan names in token counts, and the additional durable turn-error codes. Those extensions were checked against tagged persistence types. The loopback runs exercised raw message encryption, and testing of the other encrypted variants used source-derived fixtures. [Tagged response types](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/models.rs) · [Tagged persistence policy](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/rollout/src/policy.rs)

The report records 11 exact findings as reviewed for the matching phase, response and tool output audio, and plan enum changes. The mixed artifact pin stays in place. Wire-specific differences such as the nullable response metadata and the RPC `UserInput` audio field names stay open.

### 2026-11-21 remaining durable-format review

Codex realtime rollouts now parse the tagged `RealtimeItem` variants, including frames, turn handoffs, and end-of-call input. The parser still accepts the older `transcript_segment` variant without an observation time. Completed assistant messages now type the versioned moderation display material Codex serializes. Item completions type `content_token_count` and default a missing `completed_at_ms` to zero, matching Codex's recovery for older plan records. These cases use source-derived fixtures. The realtime frame fixture follows the upstream round-trip test. No live voice or moderated session was used. [Tagged realtime declarations](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/realtime.rs) · [Tagged round-trip test](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/realtime_tests.rs) · [Tagged moderation serialization](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/items/display.rs) · [Tagged item completion event](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/protocol.rs)

An isolated hook sync wrote the intended `UserPromptSubmit` hook to `hooks.json` and preserved `config.toml` byte for byte, including `hooks.state.*.trusted_content_hash`. Codex 0.171.0 accepted that TOML when loading configuration for `mcp list --json`. This verifies preservation of provider-owned state. Hook trust decisions remain with Codex. [Tagged hook discovery](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/hooks/src/engine/discovery.rs)

The checker records the trust field and seven shared nested shapes as reviewed. It keeps the App Server envelopes open, including wire differences in realtime timestamps and moderation nullability. The remaining Claude declaration and SchemaStore findings are still visible. The CLI development snapshot used the documented Mod manifest and module layout. The Mods UI and SDK control interfaces are separate contracts. [Claude Mods file reference](https://code.claude.com/docs/en/plugins/mods/reference#files) · [Claude SDK declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.330/sdk.d.ts)

### Open findings audit

The initial review covered all 17 findings triaged as affecting a Skillset format in Codex `rust-v0.171.0`. All 17 are in the App Server artifact. The open wire rows remain visible in the current report. [Tagged App Server schema](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json)

| Open paths                                                                                                                          | Reconciliation for Skillset                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentMessageDisplay` and `AgentMessageModeration` (2)                                                                              | Verified a stored-reader gap in the tagged deserializer. An absent or null display leaves the stored moderation flag intact. An unreadable display is discarded and the flag becomes true. Skillset now follows that rule. The corpus checker still reports unknown fields and discriminators on the raw record. |
| `ContentItem.output_text.annotations` and `logprobs` (2)                                                                            | The durable serializer omits absent fields and preserves provider arrays, including empty arrays. Skillset covers the stored form. The App Server schema permits null.                                                                                                                                           |
| `ResponseItem.additional_tools` (1)                                                                                                 | Skillset covers persisted IDs, role, and opaque tool arrays. The method's wire schema includes a nullable ID.                                                                                                                                                                                                    |
| `ResponseItem.*.encrypted_content` (7) and `ResponseItem.*.status` (2)                                                              | All seven stored encrypted fields and both stored status fields are covered. The durable serializer omits absent option values. The App Server nullable fields stay open.                                                                                                                                        |
| `ItemCompletedNotification.contentTokenCount`, `ThreadItem.agentMessage.moderation`, and `ThreadItem.mcpToolCall.environmentId` (3) | Skillset reads the corresponding fields in stored item completions. The App Server notification and thread-item envelopes stay open.                                                                                                                                                                             |

Source-derived fixtures verify moderation recovery and the corpus checker's inspection of the raw record. A second pass over App Server error definitions found that the durable `ErrorEvent` can serialize `rejected_audio_file_ids` on terminal turn errors. Skillset now validates those IDs. Codex explicitly excludes live misalignment details from rollout serialization. [Tagged durable response types](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/models.rs) · [Tagged moderation recovery](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/items/display.rs) · [Tagged events](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/protocol/src/protocol.rs)

The follow-up examined the App Server findings labeled _Needs verification_. The standalone image extension supplies the same image-reference and input metadata shape to App Server and persisted rollout items. Skillset now reads inline and file-backed results, prefers the file ID when an older migration record supplies both, and types source-image and generation IDs. The separate hosted `ImageGeneration` rollout item still requires `result`. The six shared image findings have exact reviews based on the tagged types and regression fixtures. No live image generation was used. [Tagged image extension](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/ext/items/src/image_generation.rs) · [Tagged migration tests](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/ext/items/src/tests.rs) · [Tagged App Server conversion](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/app-server-protocol/src/protocol/v2/item.rs)

The remaining App Server paths are classified by the scope of their owning contracts. Account and model provider RPCs, MCP management, hook trust and listings, and thread queue, realtime, usage, and turn-control views stay visible. Skillset reads and emits local configuration, hook payloads, and persisted rollout items. Terminal error values, the moderation block reason, and the web search provider enum have local counterparts and stay visible for the individual wire encodings. [Tagged App Server protocol](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/app-server/README.md) · [Tagged persistence policy](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/rollout/src/policy.rs)

The Codex configuration pass traced the 250 unclassified findings to their tagged definitions and local owners. The role loader still applies only the five existing restrictive feature overrides. The new root and profile flags, installed plugin policy, provider auth and settings, and other host controls remain visible as upstream-only. Scope rules name the examined flags so an unfamiliar flag still needs verification. [Tagged configuration definitions](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/config.schema.json) · [Tagged role loader](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/agent/role.rs) · [Tagged feature registry](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/features/src/lib.rs)

Two preset findings affect edits to shared Codex TOML. A saved prompt can contain lines that look like a table header, and Skillset previously truncated a preset if that line matched a managed MCP server. The splicer now recognizes statement boundaries across multiline values, including when applying root defaults. Tests cover basic and literal multiline preset input and full replacement or removal of a multiline scalar. An isolated `skillset doctor --json` and `skillset sync --scope user --target codex --force --json` preserved the fixture's preset, plugin defaults, and features byte for byte. Codex CLI 0.171.0 loaded the result with `mcp list --json` and returned the updated server. Exact reviews cover `Preset` and `Tui.presets`. [Tagged preset schema](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/config.schema.json)

In the Agent SDK declaration comparison, index signatures with primitive key types now have a stable identity. Their presence had forced the checker to align whole interfaces and object types by position. The pinned `Settings` comparison now reports 28 field changes, down from 440 position-based findings. Three of the 28 correspond to classic `onFailure` settings already covered by Skillset's command, HTTP, and MCP tool hook schemas. The other 25 concern host settings outside Skillset's configuration projections and remain visible. [Published Agent SDK declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.330/sdk.d.ts)

The SDK documents the saved background-task notification's `origin.runId` and the `external-event` notification subkind. Skillset now accepts the subkind and validates an optional string run ID in its shared transcript origin schema. The strict transcript checker passed three source-derived records, including an older notification without a run ID. These fixtures establish reader behavior. The origin of a live cloud delivery was outside the probe. [SDK message origin reference](https://code.claude.com/docs/en/agent-sdk/typescript#sdkmessageorigin)

The SDK follow-up matches import groups by module, named specifiers by binding, and standalone variable declarations by name. The pinned report now retains genuine binding additions, removals, and alias changes without the position shifts. The two new optional cache-write token counters already match Skillset's saved `cost-state` schema and regression fixture. The SDK archive functions store metadata beside the transcript. The published result, task, and control messages are stream contracts and remain open as upstream-only. Claude Code 2.1.330's bundled stream serializer maps its subagent ID to `agent_id` for both user and assistant frames. The durable transcript schema already types `agentId`. [Published SDK declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.330/sdk.d.ts) · [SDK session and message reference](https://code.claude.com/docs/en/agent-sdk/typescript#message-types)

The final Mod pass checked the declarations against the plugin exporter, classic lifecycle hooks, frontmatter schemas, and saved transcripts. Runtime APIs and JSON projections such as `skill.prompt`'s frontmatter snapshot stay visible as upstream-only. Exact reviews cover agent compaction settings, teammate tool results, classic hook arguments in Mod bundles, and transcript row IDs, which Skillset already handles. [Tagged Mod declarations](https://github.com/anthropics/claude-code/blob/v2.1.330/mods/types/claude-code.d.ts) · [Mod reference](https://code.claude.com/docs/en/plugins/mods/reference)

Two Mod paths exposed gaps in the saved transcript reader. Claude Code 2.1.330 running against an isolated loopback model saved `plugin_note` attachments while a note waited and after resume when it was delivered. It also saved Mod-submitted turns with a `plugin` origin and `system` turn attribution, even with `asUser: true`. Skillset validates both paths. The strict checker passed five targeted native records, and regressions cover older or optional shapes and invalid fields. Evidence applies to the CLI and saved JSONL. [Tagged `session.append` and `prompt.submit` declarations](https://github.com/anthropics/claude-code/blob/v2.1.330/mods/types/claude-code.d.ts)

The complete synthetic transcripts also included `api-request` deltas whose `base` references an earlier request ID. Skillset now validates the optional string. The strict checker passed all 75 records across both captures without schema failures or unmodeled fields.

The release replay covers every finding in the original audit table. The two remaining SchemaStore marketplace-policy changes stay open as upstream-only. The 21 open App Server findings have verified local counterparts and distinct wire encodings that stay visible. New findings outside the scoped rules still show as _Needs verification_.

## Provider behavior by version

- Codex CLI 0.160.0 documented these lifecycle hook events: `SessionStart`, `SessionEnd`,
  `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`,
  `Stop`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, plus
  Codex-only `Interrupt` (0.150.0+, #40511; fires when an active top-level
  turn is interrupted; absent from Claude Code). Hooks re-verified 2026-10-03
  against codex-cli 0.160.0 docs/release notes (installed binary 0.147.0
  confirmed the 11-event enum without `Interrupt`). Codex 0.171.0 added `PreModelRequest` and `PostModelRequest` as verified in the review above.
  Config: `~/.codex/hooks.json`, inline `[hooks]` in config.toml, project
  `.codex/hooks.json`, plugin `hooks/hooks.json`. Schema:
  `{"hooks": {"<Event>": [{"matcher": "<regex>", "hooks": [{"type": "command", "command": "...", "timeout": 600, "statusMessage": "..."}]}]}}`
  — `type: "command"` and `type: "mcp_tool"` (`server`, `tool`, `input`;
  0.148.0+, enabled in sessions 0.149.0) are operational; `prompt`/`agent`
  are "parsed but skipped". Newer handler fields: `async` (0.148.0+),
  `commandWindows`, `additionalContextLimit`. Matchers are regex: tool name
  (Pre/PostToolUse, PermissionRequest), `manual|auto` (Pre/PostCompact),
  `startup|resume|clear|compact` (SessionStart), agent type (Subagent*). Hooks are trust-gated (SHA-256 of
  the hook section, recorded in config.toml `[hooks.state]`; `/hooks` to
  trust; `--dangerously-bypass-hook-trust` to skip). The separate `notify`
  config key is a single external-program notification hook, NOT the hooks
  system. The retired `plugin_hooks` feature flag is unrelated — conflating
  it with `hooks` (which is `stable true` in `codex features list`) is how
  "Codex has no hooks" myths start.
- **Codex reads skills from BOTH `~/.agents/skills/` (standard) and
  `~/.codex/skills/` (legacy, still live — the `.system/` built-ins live
  there).** Docs only list the `.agents` chain; the filesystem proves both.
- **`license`/`compatibility`/`metadata` are agentskills.io spec fields**, not
  documented Claude Code frontmatter. Claude ignores unknown keys, so
  including them is harmless; don't cite them as Claude features.
- **SSE**: Claude Code still accepts `type: sse` (plus `ws`); Codex supports
  only stdio and streamable HTTP. Claude did not "deprecate" sse/ws; Codex
  simply can't express them.

## Claude Code (2.1.221)

**Skill frontmatter** (all optional; `description` recommended; name defaults
to directory name): `name`, `description`, `when_to_use`, `argument-hint`,
`arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`,
`disallowed-tools`, `model`, `effort` (low…max), `context: fork`, `agent`,
`background` (v2.1.218+, with fork), `hooks`, `paths`, `shell`
(bash|powershell). Booleans (`disable-model-invocation`, `user-invocable`,
`background`) accept 1/true/yes/on and 0/false/no/off, trimmed and
case-insensitive, since v2.1.218; other values read as false. `effort` is
low|medium|high|xhigh|max OR an integer. `context`: inline|fork (only fork
acts). `disallowedTools` is accepted as an alias of `disallowed-tools`.
`model: inherit` allowed. Skill frontmatter fields re-verified 2026-10-03
against 2.1.288 (binary zod schema + docs + CHANGELOG); none added since
2.1.221.
`description` + `when_to_use` truncate at 1,536 chars in the listing.
Body substitutions: `$ARGUMENTS`, `$ARGUMENTS[N]`/`$N` (0-based), named
`$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`,
`${CLAUDE_PROJECT_DIR}`; inline shell `` !`cmd` `` and ` ```! ` fences
(disable via settings `disableSkillShellExecution`).

**Agent frontmatter** (`~/.claude/agents/<name>.md`; name/description
required; name lowercase+hyphens, no `:`): `tools`, `disallowedTools`,
`model`, `permissionMode` (default|acceptEdits|auto|dontAsk|
bypassPermissions|plan|manual), `maxTurns`, `skills` (preloads full content),
`mcpServers`, `hooks` (Stop → SubagentStop), `memory` (user|project|local),
`background` (default true since v2.1.198), `effort`, `isolation: worktree`,
`color` (red|blue|green|yellow|purple|orange|pink|cyan), `initialPrompt`,
`omitClaudeMd` (2.1.271; skip user/project/local CLAUDE.md), and
`experimental.cacheTtl` (5m|1h, 2.1.248). Re-verified 2026-10-03 against
2.1.288: `isolation` accepts worktree|remote (binary; docs list only
worktree); `effort` also takes an integer; `permissionMode: manual` is an
alias for `default`; `background`/`omitClaudeMd` accept only true/false (bool
or string) — NOT the skill yes/no/on/off spellings. Undocumented binary-only
keys, modeled as optional: `observer` (non-blank agent type, trimmed),
`observerMessage` (string), `observeSubagents` (true/false; only false acts).
Skill schema @internal keys NOT modeled (Claude writes them; not
author-facing): `version`, `fallback`, `created_by`, `improved_by`, and
untyped plugin-manifest keys (`lspServers`, `themes`, `workflows`, …).
Precedence: managed > `--agents` flag > project > user > plugin.

**MCP** (`mcpServers` in `~/.claude.json` user/local scope, `.mcp.json`
project scope): `type` (stdio|http|sse|ws — required whenever `url` is
present, enforced since ~v2.1.202), `command`, `args`, `env`, `url`,
`headers`, `headersHelper` (shell command, trust-gated), `timeout` (ms),
`oauth` (`clientId`, `callbackPort`, `authServerMetadataUrl`, `scopes`).
`${VAR}` and `${VAR:-default}` expansion. No per-entry `tools` filter key.

Re-verified 2026-10-03 against Claude Code 2.1.288 (binary Zod schemas and
code.claude.com/docs/en/mcp, sub-agents, settings, model-config). Per
transport: `stdio` needs `command` (min length 1; `type` optional; `args`,
`env`, `timeout`, `alwaysLoad`, `bareElicitationCapability`); `sse` and
`http` (alias `streamable-http`) need `type` and `url` and also take
`headers`, `headersHelper`, `oauth`, `timeout`, `tools`, `alwaysLoad`,
`bareElicitationCapability`, `discoveryCache`, `toolPermissions`; `ws` needs
`type` and `url`, takes no `oauth`. `oauth`: `clientId`, `callbackPort`
(positive int), `authServerMetadataUrl` (https only), `scopes` (ONE
space-separated string), `xaa`. Loader: `url` without `type` is skipped;
`sdk`, `sse-ide`, `ws-ide` skipped from files; expansion covers `command`,
`args`, `env` values, `url`, `headers` values, not `headersHelper`. Per-server
`timeout` below 1000 ms is ignored. Unknown-key strip-vs-reject is UNVERIFIED
(inferred strip), so unknown fields are validation warnings, never errors.
Subagent `mcpServers` items: a string, or a record of server name to full
inline entry; exactly one key is enforced at load (invalid item dropped with a
warning), not in the schema. settings.json `effortLevel` accepts exactly
`low|medium|high|xhigh` (invalid value silently unset; `max`, integers,
`ultracode` rejected) — a different enum from skill/subagent frontmatter
`effort` (`low|medium|high|xhigh|max` or integer).

**Hooks** (re-verified 2026-10-03 against Claude Code 2.1.288 — docs
lifecycle table, binary strings, CHANGELOG): 33 events — the 11 shared with
Codex plus `Setup`, `UserPromptExpansion`, `StopFailure`, `PostToolBatch`,
`PermissionDenied`, `PostToolUseFailure`, `TeammateIdle`, `TaskCreated`,
`TaskCompleted`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`,
`DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`,
`Notification`, `MessageDisplay`, `Elicitation`, `ElicitationResult`,
`PreModelSwitch`, `PostModelSwitch` (the last two added in 2.1.251). No
`Interrupt`. Handler types `command`, `http`, `mcp_tool`, `prompt`, `agent`
(experimental; no longer runs on `PermissionRequest` since 2.1.280). Common
handler fields: `type`, `if` (permission-rule syntax, tool events), `timeout`
(s; default 600, 30 prompt, 60 agent, 30 on UserPromptSubmit/*ModelSwitch, 10
on MessageDisplay), `statusMessage`, `once` (skills only). command: `command`,
`args` (exec form, no shell), `async`, `asyncRewake`, `shell`. http: `url`,
`headers`, `allowedEnvVars`. mcp_tool: `server`, `tool`, `input`. prompt/agent:
`prompt`, `model`. No matcher support on `UserPromptSubmit`, `PostToolBatch`,
`Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`,
`WorktreeRemove`, `MessageDisplay`, `CwdChanged`. Skill/agent frontmatter `hooks:` uses the same schema, scoped to the
component's lifetime (agent schema: `hooks: <settings hooks schema>`, VERIFIED
in the 2.1.288 binary). Handler schema as transcribed from the 2.1.288
binary's Zod definitions (`src/hook-schema.ts` mirrors it): event keys are a
`partialRecord` over the event enum (unknown events rejected); entry
`{matcher?, hooks: [discriminated on type]}`; handler objects strip unknown
keys. Every type has `if`, `timeout` (positive number, seconds),
`statusMessage`, `once`. command: `command`, `args`, `shell`, `async`,
`asyncRewake`, @internal `rewakeMessage`/`rewakeSummary`/`cloud`
(device|skip). prompt: `prompt`, `model`, `continueOnBlock`. mcp_tool:
`server`, `tool`, `input`. http: `url` (URL), `headers`, `allowedEnvVars`,
@internal `cloud`. agent: `prompt`, `model`.

**`CLAUDE_CONFIG_DIR`** (checked 2026-10-04 against 2.1.289):
`.claude.json` lives at `join(CLAUDE_CONFIG_DIR || homedir(), ".claude.json")`, and
`settings.json` at `join(CLAUDE_CONFIG_DIR || ~/.claude, "settings.json")` (VERIFIED,
binary). Transcripts go under `CLAUDE_CONFIG_DIR ?? ~/.claude` + `projects` (VERIFIED).
The user `skills/` directory and `CLAUDE.md` are built from the same config-home
helper as `settings.json` (INFERRED from the binary's call sites). The user `agents/`
directory is INFERRED to follow the same pattern; it is not confirmed. A relative
value is an error in Claude Code ("is not an absolute path"). Claude Code reads it only
from the environment, never from a settings `env` block. The docs don't list which
paths move.

**Memory**: `CLAUDE.md` chain (managed → `~/.claude/CLAUDE.md` → project →
`CLAUDE.local.md`), `@path` imports (depth 4), `.claude/rules/*.md` +
`~/.claude/rules/*.md` with `paths:` frontmatter. `AGENTS.md` is not read
directly (import or symlink it).

## Codex CLI (0.146.x)

**Skills**: `SKILL.md` frontmatter `name` + `description` (required),
`metadata`, `arguments`, `allowed-tools` (documented). Per codex-rs
`skills/src/parser.rs` at 0.160.0, Codex only consumes `name`, `description`,
and `metadata.short-description`; other keys are tolerated. Skill `model`
was removed in 0.149.0 (#39068). No body substitution
or inline-shell preprocessing (still true). Optional `agents/openai.yaml`:
`interface` (`display_name`, `short_description`, `icon_small`, `icon_large`,
`brand_color`, `default_prompt`), `policy.allow_implicit_invocation`
(default true), `policy.products` (chatgpt|codex|atlas, plus uppercase aliases; source-only,
undocumented), `dependencies.tools[]` (`type`, `value` required;
`description`, `transport`, `url`, `command`, `oauth.callbackPort`). Parse
failures make Codex ignore the file with a warning. Discovery:
`$CWD/.agents/skills` → parents → `$REPO_ROOT/.agents/skills` →
`~/.agents/skills` → `/etc/codex/skills` → built-ins, PLUS legacy
`~/.codex/skills`. Per-skill enable/disable via config.toml `skills.config`.

**Agents** (`~/.codex/agents/*.toml`, project `.codex/agents/*.toml`;
registry `[agents.<name>]` in config.toml with `description`/`config_file`):
`name`, `description`, `developer_instructions` (multiline string), `model`,
`model_reasoning_effort` (model-dependent non-empty string — none, minimal,
low, medium, high, xhigh, max, ultra, … — not an enum), `model_verbosity`
(low|medium|high), `sandbox_mode` (read-only|workspace-write|
danger-full-access), `nickname_candidates` (verified in codex-rs
`agent_role_config.rs` at 0.160.0, undocumented: non-empty, unique after
trim, ASCII alphanumerics/space/-/_). Agent files use `deny_unknown_fields`
with any config.toml key flattened in, and per-agent `mcp_servers`,
`skills.config`, `tools`, `hooks` tables (documented; schemas match the
global config forms, NOT Claude's same-named frontmatter). Global `[agents]`:
`max_threads`/`max_concurrent_threads_per_session`, `enabled`, `max_depth`,
`default_subagent_model`, `default_subagent_reasoning_effort`.

**MCP** (`[mcp_servers.<name>]` in config.toml): `command`, `args`, `env`
(literal values), `env_vars` (names to forward), `cwd`, `url`, `auth`
(oauth|chatgpt|ema_auth), `bearer_token_env_var`, `http_headers`, `env_http_headers`,
`startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60),
`enabled`, `required`, `enabled_tools`, `disabled_tools`,
`default_tools_approval_mode` (auto|prompt|writes|approve), per-tool
`[mcp_servers.<name>.tools.<tool>] approval_mode`, `oauth_resource`,
`environment_id`. `codex mcp add|list|get|remove|login|logout`.

Re-verified 2026-10-03 against codex-cli 0.160.0 (config.schema.json,
mcp_types.rs at rust-v0.160.0). `command` selects stdio, `url` selects
streamable HTTP, and cross-transport fields error: stdio rejects `url`,
`bearer_token_env_var`, `http_headers`, `env_http_headers`,
`http_headers_helper`, `oauth`, `oauth_resource`, `auth`; HTTP rejects `args`,
`env`, `env_vars`, `cwd`; `bearer_token` is always rejected. 0.160 has NO
`experimental_environment` — the field is `environment_id` (docs are stale;
the runtime silently ignores unknown keys, the published JSON schema flags
them). New since 0.147: `startup_readiness` (connection|catalog),
`tool_input_schema_max_bytes`, `http_headers_helper`,
`tools.<t>.output_token_limit`, `oauth.{client_secret,callback_url,callback_port,authorization_server_issuer}`;
also `environment_id`, `omit_tools_from` (code_mode|deferred|direct),
`supports_parallel_tool_calls`, `scopes`, `startup_timeout_ms`, `auth`
(oauth|chatgpt|ema_auth), `env_vars` entries as a name or `{name, source}`.
The `oauth` table, object-form `env_vars` entries, and `tools.<tool>` tables
also reject unknown keys in the published schema. Agent role files:
`mcp_servers` and `sandbox_mode` are validated then DROPPED by role.rs
(0.149+), so they have no runtime effect in an agent file in 0.160 even though
the Codex docs still list them.

**Codex hooks, skills, and tools tables** (re-verified 2026-10-03 against
codex-cli 0.160.0: hook_config.rs, discovery.rs, skills_config.rs, role.rs,
config.schema.json at rust-v0.160.0). `[hooks]` (also hooks.json, whose top
level is strict `{description?, hooks}`): 12 PascalCase event tables of
`{matcher?, hooks[]}` groups plus a `state` table (`{enabled?, trusted_hash?}`
per hook key). Handler types: `command` (`command` required and non-blank,
`commandWindows`/`command_windows`, `timeout` integer seconds, default 600 and
1 to 3 for SessionEnd/Interrupt, `statusMessage`, `async` forced sync on
SessionEnd, `additionalContextLimit`) and `mcp_tool` (`server`, `tool`,
`input`, `timeout`, `statusMessage`; not run on SessionEnd). `prompt` and
`agent` parse (extra keys ignored) and are then skipped with a load-failure
warning, so Codex never runs them. Unknown handler keys are ignored. An
unknown handler `type` is INFERRED to be a parse error (serde tagged enum), so
validation only warns. `[skills]`: `bundled.enabled`, `include_instructions`,
`max_context_tokens`, `[[skills.config]]` rules of `{path|name, enabled}`
(`enabled` required; exactly-one-of `path`/`name` is INFERRED, not enforced by
the schema). `[tools]` is a strict table, not an allowlist:
`experimental_request_user_input.enabled`, `update_plan.enabled`,
`web_search.{allowed_domains,context_size,location}`; there is no per-agent
tool allowlist array. In a role file all three are validated against
`ConfigToml`, but role.rs projects only restrictive skills entries
(`enabled = false`, disabled bundled set, `include_instructions = false`);
`hooks` and `tools` are dropped (role_tests hostile-role test).

**Hook payloads** (verified 2026-10-03 against Claude Code 2.1.288: binary
Zod schemas plus code.claude.com/docs/en/hooks; codex-cli 0.160.0:
`codex-rs/hooks/schema/generated`, `output_parser.rs`, per-event files at
rust-v0.160.0). `src/claude-hook-*.ts` and `src/codex-hook-payloads.ts`
encode them as the public `@lostgradient/skillset` exports. Claude: every
event's stdin is the common fields (`session_id`, `transcript_path`, `cwd`
required; optional `scratchpad_dir`, `prompt_id`, `permission_mode` (plain
string), `agent_id`, `agent_type`, `effort.level`) plus event fields; stdout is
one object (`continue`, `suppressOutput`, `stopReason`, `decision`
`approve|block`, `reason`, `systemMessage`, `terminalSequence`,
`hookSpecificOutput`) or the async form `{async: true, asyncTimeout?}`. The
binary has 22 `hookSpecificOutput` variants; SessionEnd, StopFailure,
PreCompact, PostCompact, TeammateIdle, TaskCreated, TaskCompleted,
InstructionsLoaded, ConfigChange, DirectoryAdded, WorktreeRemove have none.
Setup and Notification have variants but Claude discards their output.
`StopFailure.error` has 13 values in the binary (docs list 12; the extra is
`verification_required`). `UserPromptSubmit.source` is in the binary but not
the docs. `scratchpad_dir` is sent at runtime (2.1.257) but absent from the
binary's exported schema. The binary accepts top-level `decision: approve`,
the docs say `block` only. `hookSpecificOutput.hookEventName` must match the
running event or Claude throws. Payload objects are loose: the binary strips
unknown output keys (INFERRED from plain Zod objects, not tested). Codex:
stdin always carries `session_id`, `transcript_path` (string or null), `cwd`,
`hook_event_name`; `model` on all but SessionEnd; `turn_id` on all but
SessionStart/SessionEnd; `permission_mode` (enum of five, runtime emits only
`default` or `bypassPermissions`) except SessionEnd, PreCompact, PostCompact;
`agent_id`/`agent_type` optional on PreToolUse, PermissionRequest,
PostToolUse, PreCompact, PostCompact, UserPromptSubmit and required on
SubagentStart/SubagentStop. Codex output structs use `deny_unknown_fields`, so
one unknown key marks the run Failed: the exported output schemas are strict.
SessionEnd stdout is never parsed (no schema). Interrupt output accepts only
`systemMessage`. Compaction output is the four universal fields only. On
PreToolUse, PermissionRequest, and PostToolUse, `continue: false`, any
`stopReason`, and `suppressOutput: true` fail the run, so the exported schemas
reject them there. Stop and
SubagentStop have no `hookSpecificOutput`. PreToolUse `ask`/`approve` parse but
fail the run, `allow` needs `updatedInput`, `deny` needs a reason; these
semantic rules are documented, not encoded. Delta from 0.147 to 0.160: new
Interrupt event, SessionStart `source` gained `fork`. UNVERIFIED: whether Rust
checks `hookEventName` inside `hookSpecificOutput` against the running event,
exact `tool_response` shapes for MCP tools, per-tool `tool_input` shapes (kept
`unknown`), introduction versions of PostToolBatch and UserPromptExpansion.

**`CODEX_HOME`** (VERIFIED, codex-rs `utils/home-dir` and `ext/skills/src/host_roots.rs` at
rust-v0.160.0): defaults to `home_dir()/.codex` and moves `config.toml`, `agents/`,
`hooks.json`, and `AGENTS.md`. User skills stay at `home_dir()/.agents/skills`, and
`$CODEX_HOME/skills` is only the deprecated legacy root.

**Other config.toml surface** worth knowing: `model*` keys,
`approval_policy` (untrusted|on-request|never), `sandbox_mode`,
`shell_environment_policy`, `features` (check `codex features list` — the
authoritative per-version flag inventory), `notify`, `[hooks]`/
`[hooks.state]`, `apps`, `plugins`/`marketplaces`, `[projects."<path>"]
trust_level`, profiles via `$CODEX_HOME/<name>.config.toml` (`-p` flag;
nested `[profiles.*]` deprecated), `project_doc_fallback_filenames` (this
machine: `["CLAUDE.md"]` — Codex falls back to reading CLAUDE.md when
AGENTS.md is absent), `model_instructions_file`, enterprise
`requirements.toml`/`managed_config.toml` (incl. `allow_managed_hooks_only`).
`--strict-config` makes Codex error on unknown keys — useful for checking a config.toml by hand.

## Open verification questions

- Whether Codex substitutes declared `arguments` into skill bodies at
  runtime (the field is documented; substitution semantics are not).
