---
name: tool-format-research
description: How to research and verify Claude Code and Codex CLI functionality before changing this project's compilers, doctor rules, or documentation. Use before adding/removing any frontmatter field, mapping, fallback, or "X is unsupported" claim.
---

# Researching Claude Code and Codex functionality

This project compiles configuration for two fast-moving tools. Every compiler
decision encodes a factual claim about what those tools support, and a wrong
claim ships wrong output. Follow this procedure before changing any schema,
mapping, doctor warning, or README statement about either tool.

## Ground truth, in order of authority

1. **The installed CLIs.** Run them read-only; their help output and behavior
   beat every document:
   - `claude --help`, `claude mcp --help`, `claude plugin --help`
   - `codex --help`, and every subcommand's `--help`
   - Versions: `claude --version`, `codex --version` — record them in your
     findings; support is version-gated in both tools.
2. **Official documentation.**
   - Claude Code: https://code.claude.com/docs/en/ (skills, sub-agents, hooks,
     mcp, settings, plugins, memory). Platform-level validation rules:
     https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
   - Codex: https://developers.openai.com/codex/ — NOTE: this 308-redirects
     (currently to learn.chatgpt.com). Follow the redirect and treat the
     target as canonical; do not stop at the redirect stub.
   - The openai/codex GitHub repo `docs/` directory and release notes — often
     ahead of the published docs site.
3. **Changelogs** for anything recent: github.com/anthropics/claude-code
   CHANGELOG.md; openai/codex releases.
4. **Local installs as evidence of real-world formats** (read-only!):
   `~/.claude/skills`, `~/.claude/agents`, `~/.claude/settings.json`,
   `~/.codex/config.toml`, `~/.codex/agents/`, `~/.agents/skills/`. These show
   what actually parses today — but they can lag the tools, so they prove
   "supported", never "unsupported".

Third-party blogs and secondary summaries are leads, never sources. If a
claim only appears in a blog post, verify it against 1–3 before acting on it.

## Rules that prevent past mistakes

- **Absence of documentation is not absence of the feature.** Never write
  "tool X does not support Y" because a docs page doesn't mention Y. That
  claim requires positive evidence: an explicit doc statement, a CLI error,
  or a maintainer statement. Otherwise write "not found in the docs as of
  <date>; unverified" — and do not encode it in a doctor warning.
- **Date and version every claim.** Findings must carry the doc URL, the
  fetch date, and the CLI version probed.
- **Label VERIFIED vs INFERRED.** VERIFIED = direct quote or command output
  you saw. INFERRED = anything else. Only VERIFIED claims may become schema
  fields, mappings, or doctor errors; INFERRED at most becomes a warning with
  hedged wording.
- **Fan out, then reconcile.** For a broad sweep, run parallel research
  agents (one per tool, plus one auditing this repo's existing claims via the
  claim checklist below), then reconcile disagreements yourself against
  ground truth before touching code.
- **When the two tools disagree with our union format**, prefer changing our
  compiler over documenting around it. The union frontmatter exists to absorb
  differences.

## Extracting this repo's current claims

Every factual claim lives in a small set of files — audit these when
re-verifying:

- `src/frontmatter.ts`, `src/agent-frontmatter.ts` — field lists and enums.
- `src/doctor.ts` — validation limits and every "has no Codex equivalent"
  warning (each one is a falsifiable claim).
- `src/fallback.ts` — the "Codex lacks inline shell / $ARGUMENTS / ${CLAUDE_*}"
  rationale.
- `src/mcp-config.ts` — target schemas and mapping rules.
- `src/cli.ts` (`defaultTargetRoots`, `defaultMcpFiles`) — storage paths.
- `README.md`, `CLAUDE.md` — prose restatements of all of the above.

## After research

Update `.claude/skills/tool-format-reference/SKILL.md` with the corrected
facts (it is the project's shared memory of both tools' surfaces), then update
the compilers, doctor, tests, and README together — never just one of them.
