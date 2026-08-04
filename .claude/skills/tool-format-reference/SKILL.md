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
  `Stop`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`.
  Config: `~/.codex/hooks.json`, inline `[hooks]` in config.toml, project
  `.codex/hooks.json`, plugin `hooks/hooks.json`. Schema:
  `{"hooks": {"<Event>": [{"matcher": "<regex>", "hooks": [{"type": "command", "command": "...", "timeout": 600, "statusMessage": "..."}]}]}}`
  — only `type: "command"` is operational. Hooks are trust-gated (SHA-256 of
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
(bash|powershell). Booleans accept yes/no/on/off/1/0 since v2.1.218.
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
`color` (red|blue|green|yellow|purple|orange|pink|cyan), `initialPrompt`.
Precedence: managed > `--agents` flag > project > user > plugin.

**MCP** (`mcpServers` in `~/.claude.json` user/local scope, `.mcp.json`
project scope): `type` (stdio|http|sse|ws — required whenever `url` is
present, enforced since ~v2.1.202), `command`, `args`, `env`, `url`,
`headers`, `headersHelper` (shell command, trust-gated), `timeout` (ms),
`oauth` (`clientId`, `callbackPort`, `authServerMetadataUrl`, `scopes`).
`${VAR}` and `${VAR:-default}` expansion. No per-entry `tools` filter key.

**Hooks**: ~30 events (Session/turn/tool/agent-team/file/context/notification/
MCP families); handler types `command`, `http`, `mcp_tool`, `prompt`,
`agent`. Skill/agent frontmatter `hooks:` uses the same schema, scoped to the
component's lifetime.

**Memory**: `CLAUDE.md` chain (managed → `~/.claude/CLAUDE.md` → project →
`CLAUDE.local.md`), `@path` imports (depth 4), `.claude/rules/*.md` +
`~/.claude/rules/*.md` with `paths:` frontmatter. `AGENTS.md` is not read
directly (import or symlink it).

## Codex CLI (0.146.x)

**Skills**: `SKILL.md` frontmatter `name` + `description` (required),
`metadata`, `arguments`, `allowed-tools` (documented). No body substitution
or inline-shell preprocessing (still true). Optional `agents/openai.yaml`:
`interface` (`display_name`, `short_description`, `icon_small`, `icon_large`,
`brand_color`, `default_prompt`), `policy.allow_implicit_invocation`
(default true), `dependencies` (MCP server requirements). Discovery:
`$CWD/.agents/skills` → parents → `$REPO_ROOT/.agents/skills` →
`~/.agents/skills` → `/etc/codex/skills` → built-ins, PLUS legacy
`~/.codex/skills`. Per-skill enable/disable via config.toml `skills.config`.

**Agents** (`~/.codex/agents/*.toml`, project `.codex/agents/*.toml`;
registry `[agents.<name>]` in config.toml with `description`/`config_file`):
`name`, `description`, `developer_instructions` (multiline string), `model`,
`model_reasoning_effort`, `model_verbosity`, `sandbox_mode` (read-only|
workspace-write|danger-full-access), and per-agent `mcp_servers`,
`skills.config`, `tools`, `hooks` tables (documented; schemas match the
global config forms, NOT Claude's same-named frontmatter). Global `[agents]`:
`max_threads`/`max_concurrent_threads_per_session`, `enabled`, `max_depth`,
`default_subagent_model`, `default_subagent_reasoning_effort`.

**MCP** (`[mcp_servers.<name>]` in config.toml): `command`, `args`, `env`
(literal values), `env_vars` (names to forward), `cwd`, `url`, `auth`
(oauth|chatgpt), `bearer_token_env_var`, `http_headers`, `env_http_headers`,
`startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60),
`enabled`, `required`, `enabled_tools`, `disabled_tools`,
`default_tools_approval_mode` (auto|prompt|writes|approve), per-tool
`[mcp_servers.<name>.tools.<tool>] approval_mode`, `oauth_resource`,
`experimental_environment`. `codex mcp add|list|get|remove|login|logout`.

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
  `developer_instructions`; `codex.tools` available for the native table.
- Agent `hooks`/`mcpServers`/`skills` → NOT auto-translated (schemas differ);
  authors set `codex.hooks`/`codex.mcp_servers`/`codex.skills`, emitted
  verbatim; doctor reminds when the Claude side is set without them.
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
  and Codex's hooks.json — the entry shape is shared; Codex is restricted to
  its 11 events and command handlers; `timeout` is seconds in both; Codex
  writes require re-trusting via `/hooks`.
- Instructions: `instructions.md` → `CLAUDE.md` / `AGENTS.md`; Claude `@path`
  imports have no Codex equivalent (doctor warns unless guarded).
- Defaults: `defaults.yaml` → settings.json `model`/`effortLevel` and
  config.toml `model`/`model_reasoning_effort`/`model_verbosity` scalars.

## Open questions (unverified — do not encode as fact)

- Whether Codex substitutes declared `arguments` into skill bodies at
  runtime (the field is documented; substitution semantics are not). We emit
  the field and still prose-rewrite `$name` tokens.
- The exact schema of the Codex per-agent `tools` table (documented to exist;
  shape not observed). `codex.tools` is passed through verbatim.
- Claude-to-Codex hook auto-translation: both support command hooks on an
  overlapping event set, so a partial compiler is feasible — deliberately not
  built yet.
