---
name: tool-format-reference
description: Verified reference for Claude Code and Codex CLI configuration surfaces (skills, agents, MCP, hooks) that this project compiles. Consult before changing schemas, mappings, or doctor rules; update after every research pass.
---

# Verified tool-format reference

Verified August 2026 against Claude Code 2.1.221 and codex-cli 0.146.0-alpha.9.2
(installed CLIs probed directly) plus official docs. Follow
[tool-format-research](../tool-format-research/SKILL.md) to re-verify before
relying on this after either tool has had major releases.

## Headline corrections (things commonly gotten wrong)

- **Codex HAS lifecycle hooks.** Events: `SessionStart`, `SessionEnd`,
  `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`,
  `Stop`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, plus
  Codex-only `Interrupt` (0.150.0+, #40511; fires when an active top-level
  turn is interrupted; absent from Claude Code). Hooks re-verified 2026-10-03
  against codex-cli 0.160.0 docs/release notes (installed binary 0.147.0
  confirmed the 11-event enum without `Interrupt`).
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
  emitting them is harmless; don't cite them as Claude features.
- **SSE**: Claude Code still accepts `type: sse` (plus `ws`); Codex supports
  only stdio and streamable HTTP. Reject sse/ws in union sources because
  Codex can't express them — not because Claude "deprecated" them.

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
(inferred strip), so unknown fields are doctor warnings, never errors.
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
also reject unknown keys in the published schema (skillset warns with dotted
paths such as `oauth.clientid`). Agent role files: `mcp_servers` and
`sandbox_mode` are validated then DROPPED by role.rs (0.149+), so
`codex.mcp_servers` and `codex.sandbox_mode` (including one implied by
`permissionMode`) in an agent have no runtime effect in 0.160 even though the
Codex docs still list them.

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
doctor only warns. `[skills]`: `bundled.enabled`, `include_instructions`,
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
`systemMessage`. Compaction output is the four universal fields only. Stop and
SubagentStop have no `hookSpecificOutput`. PreToolUse `ask`/`approve` parse but
fail the run, `allow` needs `updatedInput`, `deny` needs a reason; these
semantic rules are documented, not encoded. Delta from 0.147 to 0.160: new
Interrupt event, SessionStart `source` gained `fork`. UNVERIFIED: whether Rust
checks `hookEventName` inside `hookSpecificOutput` against the running event,
exact `tool_response` shapes for MCP tools, per-tool `tool_input` shapes (kept
`unknown`), introduction versions of PostToolBatch and UserPromptExpansion.

**Other config.toml surface** a compiler should know: `model*` keys,
`approval_policy` (untrusted|on-request|never), `sandbox_mode`,
`shell_environment_policy`, `features` (check `codex features list` — the
authoritative per-version flag inventory), `notify`, `[hooks]`/
`[hooks.state]`, `apps`, `plugins`/`marketplaces`, `[projects."<path>"]
trust_level`, profiles via `$CODEX_HOME/<name>.config.toml` (`-p` flag;
nested `[profiles.*]` deprecated), `project_doc_fallback_filenames` (this
machine: `["CLAUDE.md"]` — Codex falls back to reading CLAUDE.md when
AGENTS.md is absent), `model_instructions_file`, enterprise
`requirements.toml`/`managed_config.toml` (incl. `allow_managed_hooks_only`).
`--strict-config` makes Codex error on unknown keys — useful for validating
our emitted TOML.

## How skillset maps between them (current behavior)

- Skill `disable-model-invocation: true` → openai.yaml
  `policy.allow_implicit_invocation: false` (explicit `openai.policy` wins).
- Agent `permissionMode`: `plan` → `sandbox_mode = "read-only"`,
  `acceptEdits` → `"workspace-write"`; others unmapped (doctor warns).
- Agent `tools`/`disallowedTools` → prose "Tool guidance" in
  `developer_instructions`; Codex has no per-agent tool allowlist, and
  `codex.tools` is the `[tools]` settings table (validated, dropped by Codex).
- Agent `hooks`/`mcpServers`/`skills` → NOT auto-translated (schemas differ);
  authors set `codex.hooks`/`codex.mcp_servers`/`codex.skills`, typed against
  Codex 0.160's tables (hooks reuse the hooks.yaml Codex handler schema) and
  emitted as TOML; doctor reminds when the Claude side is set without them.
- Dropped for Codex (no documented equivalent): agent `maxTurns`, `memory`,
  `background`, `isolation`, `initialPrompt`.
- MCP: `Bearer ${VAR}` Authorization → `bearer_token_env_var`; `${VAR}`-only
  headers → `env_http_headers`; static → `http_headers`; `${VAR}`-only env
  values → `env_vars`; `timeout` ms → `tool_timeout_sec` (rounded seconds).
- Codex body fallbacks: `` !`cmd` `` → code span + run note; `$ARGUMENTS`/
  `$N`/named → prose; `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PROJECT_DIR}` → prose;
  `${CLAUDE_SESSION_ID}`/`${CLAUDE_EFFORT}` → dropped (guard with
  `#if claude`).
- Hooks: `hooks.yaml` compiles to the `hooks` key of Claude's settings.json
  and Codex's hooks.json — the entry shape is shared. A definition's `type`
  (default `command`) may be `command`, `http`, `mcp_tool`, `prompt`, or
  `agent`; Claude runs all five, Codex runs only `command` and `mcp_tool`
  (`mcp_tool` not on SessionEnd), so the others need `targets: [claude]`.
  Each merged per-target handler is validated against that target's schema
  (errors) and fields it does not read warn. `timeout` is seconds in both;
  Codex writes require re-trusting via `/hooks`.
- Instructions: `instructions.md` → `CLAUDE.md` / `AGENTS.md`; Claude `@path`
  imports have no Codex equivalent (doctor warns unless guarded).
- Defaults: `defaults.yaml` → settings.json `model`/`effortLevel` and
  config.toml `model`/`model_reasoning_effort`/`model_verbosity` scalars.

## Open questions (unverified — do not encode as fact)

- Whether Codex substitutes declared `arguments` into skill bodies at
  runtime (the field is documented; substitution semantics are not). We emit
  the field and still prose-rewrite `$name` tokens.
- Claude-to-Codex hook auto-translation: both support command hooks on an
  overlapping event set, so a partial compiler is feasible — deliberately not
  built yet.
