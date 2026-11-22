---
name: maintain-provider-compatibility
description: Use this skill to keep Skillset compatible with Claude Code and Codex releases, from detecting upstream drift through updating and verifying schemas, payload types, guards, and JSON Schema exports.
---

# Maintain Skillset provider compatibility

## Gotchas

- Separate the target release from the installed probe version. CLI help, parser acceptance, discovery, execution, and Desktop availability prove different things. A parser that accepts an unknown field may silently ignore it.
- Provider settings, classic hook payloads, RPC messages, and stored records are distinct contracts. Use Skillset's public validators and schemas to determine what the library covers.
- Claude Code Mods use plugin modules and the Mods API. Review those contracts separately from classic lifecycle hook settings and stdin/stdout payloads.
- Resolve paths in this skill from the repository root. The Claude Code entry is a relative symlink to the same project skill Codex reads.

## Start an audit

First run the drift checker from the repository root.

```bash
bun run scripts/check-provider-drift.ts
```

Use `--json` for the full report with source URLs and structural change paths. The script resolves stable CLI tags, the published Agent SDK version, and the SchemaStore revision independently. Use the tag, package version, and commit options in `--help` to replay a report. Exit zero means the comparison completed. Review the report even when the command succeeds.

Start with the _Needs work_ summary and its follow-up findings. Review findings labeled _Review Skillset impact_, check those labeled _Verify scope_, and investigate missing hook entries. Use `--all` to see the scope table and every reference-only finding. In that table, _Still listed_ includes reference-only findings and _Recorded as reconciled_ counts exact review records. JSON includes `needsWork` counts and each finding's category, reason, and action under `triage`. When a new source-backed scope decision will apply to future diffs, record the narrow artifact and path in `scripts/provider-drift-triage.ts`.

The script compares Codex configuration, generated hook payload schemas, and App Server JSON-RPC with Claude Code's tagged Mod declarations, Agent SDK declarations, and SchemaStore settings. The checker also compares published hook event names with Skillset's registries. Claude SDK event parity applies to SDK callbacks.

Update the upstream pins in `scripts/provider-artifacts.ts` after reconciling every difference governed by the pin. Remove the review entries absorbed by a new pin. For a partial review, record the artifact, its pinned target URL, and each verified change's path and fingerprint from `--json` in `scripts/provider-reviewed-changes.ts` with the evidence or a pointer to it. Rerun with the same target versions. Confirm those changes moved from `changes` to `reviewed` and every unresolved change stayed in `changes`. A subsequent edit or reversion at a reviewed path needs its own review.

Run an audit after a stable release, when a provider adds a configuration surface, and before changing compatibility-sensitive behavior or cutting a Skillset release. For a focused request, review the affected rows. For a release sweep, walk every row and scan intervening release notes and documentation indexes for new surfaces. Read [the compatibility reference](../../../.claude/skills/tool-format-reference/SKILL.md) for previous evidence, and record `claude --version` and `codex --version` before probing. Frontmatter and on-disk session records still need targeted fixtures. Reopen official docs for the reviewed surfaces because they can change independently of tags.

| Surface                              | Skillset code to compare                                                                                  | Upstream starting points                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill and subagent frontmatter       | `src/frontmatter.ts`, `src/agent-frontmatter.ts`, `src/validate-metadata.ts`, `src/codex-agent-tables.ts` | [Agent Skills spec](https://agentskills.io/specification), [Claude skills](https://code.claude.com/docs/en/skills), [Claude subagents](https://code.claude.com/docs/en/sub-agents), [Codex skills](https://developers.openai.com/codex/skills), [Codex subagents](https://developers.openai.com/codex/subagents) |
| Hook settings and payloads           | `src/hook-schema.ts`, `src/claude-hook-*.ts`, `src/codex-hook-payloads.ts`                                | [Claude hooks](https://code.claude.com/docs/en/hooks), [Codex hooks](https://developers.openai.com/codex/hooks), tagged source                                                                                                                                                                                   |
| MCP server entries                   | `src/mcp-schema.ts`, `src/agent-mcp-servers.ts`                                                           | [Claude MCP](https://code.claude.com/docs/en/mcp), tagged Codex configuration schema                                                                                                                                                                                                                             |
| Claude Mods                          | `scripts/claude-mod-types.ts`, matching types in `src/claude-session-*.ts`                                | [Claude Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), [first-party Mods](https://github.com/anthropics/claude-code/tree/main/mods)                                                                                                                                                    |
| Session records and Claude workflows | `src/claude-session-*.ts`, `src/codex-session-*.ts`, `src/claude-workflow-*.ts`                           | Release notes, tagged persistence and workflow types, targeted runtime fixtures                                                                                                                                                                                                                                  |

## Verify and reconcile

- For each candidate delta, cite tagged source or official docs and use the matching CLI to test behavior where available. Record the exact version, surface, feature flags, command, and observable result. Mark evidence from moving docs or another version as such. Treat undocumented behavior as unverified until a version-matched source or probe establishes it.
- Use minimal synthetic fixtures in a temporary project and isolated configuration directories. Check candidate fixtures with the provider and the corresponding Skillset validator or schema. Use trusted, inert fixtures for runtime tests.
- For Mods, fetch a tagged declaration with `bun run scripts/claude-mod-types.ts <tag>` for local type checks. Inspect the plugin manifest, `hooks/hooks.json` module entry, registration code, and any state/type declarations separately. Follow the [version-specific type generation procedure](https://code.claude.com/docs/en/plugins/mods/create) and inspect `.claude-plugin/types/claude-code/index.d.ts` from the target runtime. Run `claude plugin validate <fixture>` for static recognition and `claude plugin test <fixture>` for fixture behavior. Record CLI, Desktop, and cloud evidence separately when relevant.
- For transcript and workflow changes, use the existing local corpus checkers with explicit fixture roots: `bun run check:claude-sessions --root <directory>`, `bun run check:codex-sessions --root <directory>`, and `bun run check:workflows --root <directory>`. Inspect the summary and confirm it actually checked the relevant records. Keep raw local sessions, credentials, and generated connector-specific declarations out of tracked fixtures and reports.
- Record each delta as covered, a confirmed gap, or unverified. Identify the local owner and what new fixtures would prove. When implementing a confirmed change, add a regression for the affected parser or schema and keep the schema, diagnostics, public exports, guards, JSON Schema definitions, and documentation consistent where they apply. Run the focused `bun test <paths>` and then `bun run validate`.
- Update the compatibility reference with the date, target tag, probe version, source links, verified scope, unresolved items, and check results. Advance a surface's last reviewed tag only when the whole row was compared. A recorded gap can remain open after review. An interrupted or sample-only audit leaves that row's cursor in place.
