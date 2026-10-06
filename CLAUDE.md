# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development

```bash
bun run build             # Build for production (outputs to dist/)
```

### Testing

```bash
bun test                  # Run all tests
bun test src/utils        # Run tests in specific directory
bun test logger           # Run tests matching pattern
bun test --watch          # Watch mode
bun test --coverage       # Generate coverage report
```

### Code Quality

```bash
bun run lint             # Check linting errors
bun run lint:fix         # Auto-fix linting errors
bun run typecheck        # TypeScript type checking (src + scripts)
bun run typecheck:test   # TypeScript type checking (test files)
bun run format           # Format all files with Prettier
bun run format:check     # Check formatting without changes
bun run check            # Fast local sanity: format:check + lint + typecheck
bun run validate         # Full gate: format:check + lint + typecheck + typecheck:test + test + build + package:check + verify:package-types
```

### Utilities

```bash
bun run clean            # Clean build artifacts (dist/, coverage/, caches)
bun run package:check    # Run publint + @arethetypeswrong/cli on packed tarball
```

**`package:check` packs with `bun pm pack` itself and hands the tarball to `attw`, rather than using `attw --pack`.** `attw --pack` shells out to a hardcoded `npm pack` internally, which breaks when it runs nested inside an active `npm publish` — `npm publish` triggers the `prepublishOnly` script (`bun run validate`, which includes `package:check`) from _inside its own npm process_, and a second `npm pack` invoked from there fails silently, leaving `attw` to report a baffling `ENOENT: ... open '@lostgradient-skillset-<version>.tgz'` instead of the real cause. `scripts/check-package.ts` avoids this entirely. If that `ENOENT` ever reappears, something reintroduced `attw --pack`.

## Architecture Overview

`skillset` is a pure library: Zod schemas, type guards, and validators for Claude Code's and Codex's configuration and runtime formats. Nothing in `src/` reads or writes files, and nothing runs at import. See `README.md` for the public API and `.claude/skills/tool-format-reference` for the verified facts each schema encodes.

### Module Layout (`src/`)

- `index.ts` — the public API. `public-api.test.ts` fails if a module exports a schema `index.ts` doesn't, if a public schema has no inferred type, or if any export is missing from `README.md`.
- `entry-hooks.ts` / `entry-sessions.ts` / `entry-workflows.ts` — the `./hooks`, `./sessions`, and `./workflows` subpath entry points. Each re-exports a slice of `index.ts`; `public-api.test.ts` checks each is a subset of the root, and the build uses `splitting` so they share one copy of each schema and error class.
- `frontmatter.ts` — Claude Code's and Codex's SKILL.md frontmatter schemas, `agents/openai.yaml`, the two effort schemas, and `parseClaudeSkillMapping`/`parseCodexSkillMapping`.
- `agent-frontmatter.ts` — Claude Code's subagent frontmatter schema, the Codex agent file schema (loose: it may carry any config.toml key), and `parseClaudeAgentMapping`.
- `validate-metadata.ts` — `validateSkillMetadata`/`validateSubagentMetadata`: parse one file with gray-matter (executable engines disabled), validate against the target tool's schema, then run the rules in `doctor.ts`.
- `doctor.ts` — naming, description, hook-field, unknown-key, and length rules for skills and subagents (`checkParsedSkill`/`checkParsedAgent`).
- `doctor-anti-patterns.ts` — warnings for valid-but-suspect frontmatter (vague name, first-person description, `bypassPermissions`, a tool both allowed and denied).
- `issue.ts` — the `Issue` type and its helpers.
- `hook-schema.ts` — both tools' hook event sets, Claude Code's hook settings schema (settings.json and skill/subagent frontmatter `hooks`), and Codex's hook handler and settings schema.
- `mcp-schema.ts` — Claude Code's MCP server entry schema and Codex's `[mcp_servers.<name>]` schema with its transport rules.
- `agent-mcp-servers.ts` — the subagent `mcpServers` item schema and the checks for items Claude Code drops.
- `codex-agent-tables.ts` — Codex's `[skills]` and `[tools]` tables.
- `claude-hook-shared.ts` / `claude-hook-input-schemas.ts` / `claude-hook-output-schemas.ts` / `codex-hook-payloads.ts` — schemas for every hook event's stdin input and stdout output (inputs loose, Codex outputs strict), with `parse*HookInput`/`parse*HookOutput` helpers.
- `claude-session-*.ts` / `codex-session-*.ts` — Zod schemas for Claude Code session transcripts and Codex session rollouts (JSONL), checked against real sessions by `scripts/check-claude-session-schema.ts` and `scripts/check-codex-session-schema.ts` (`bun run check:claude-sessions` / `check:codex-sessions`).
- `claude-workflow-*.ts` — Zod schemas, script-API types, and static helpers for Claude Code workflow scripts: `meta` (`claude-workflow-meta.ts`), `agent()` options and the output-schema root (`-agent-options.ts`), the Workflow tool input/output, `workflow()` reference, and `budget` (`-tool.ts`), the `wf_<id>.json` run record (`-run-record.ts`), acorn-based source helpers (`-ast.ts`, `-source.ts` for `meta` and forbidden APIs, `-calls.ts` for `agent()`/`workflow()`/`phase()` calls), and types for the script globals (`-script-api.ts`). `claude-workflow-globals.ts` declares those globals and is shipped as the `@lostgradient/skillset/workflow-globals` subpath; it must never be re-exported from `index.ts`, or `agent` and `pipeline` become globals for every consumer. Checked against real workflows by `scripts/check-workflow-schema.ts` (`bun run check:workflows`); `scripts/verify-package-types.ts` type-checks a plain JavaScript script against the shipped globals.
- `type-guards.ts` — a schema-backed type guard for every public top-level schema (narrows to `z.input`).
- `byte-order-mark.ts` — `withoutByteOrderMark`, used before parsing any user-editable file.

### Core Design Principles

1. **Pure and side-effect free**: no filesystem, network, or environment access in `src/`, and nothing runs at import. Callers read files and pass in their text.

2. **Verified, not guessed**: every schema field and rule comes from what the tool actually accepts (binary schemas, published schemas, docs). Follow `.claude/skills/tool-format-research` before adding or removing one, and record the result in `tool-format-reference`. Where acceptance is unverified, prefer a warning over an error.

3. **Runtime-Neutral Published Code**: `src/` must not use Bun-only runtime APIs (`Bun.file`, `Bun.env`, `Bun.serve`, etc.). Those APIs are fine in `scripts/` and test files, but must not appear in published library output.

### Key Notes

- **ESM + TypeScript**: Source files are TypeScript modules; build output targets both Node and Bun.
- **Import paths**: Use standard TS/ESM imports; no `@/*` path alias (it leaks into `.d.ts` files).
- **Library output**: Dual-emit — `dist/node/` for Node consumers, `dist/bun/` for Bun consumers. The `exports` map routes consumers automatically.

### Library Packaging

The build produces:

- `dist/node/index.js` — ESM bundle, `Bun.build target: 'node'`, all deps external
- `dist/bun/index.js` — ESM bundle, `Bun.build target: 'bun'`, all deps external
- `dist/index.d.ts` — TypeScript declarations (shared)
- `entry-hooks`, `entry-sessions`, `entry-workflows`, and `claude-workflow-globals` — the same for each subpath, with shared modules split into chunks

The `exports` map in `package.json`:

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "bun": "./dist/bun/index.js",
    "import": "./dist/node/index.js",
    "default": "./dist/node/index.js"
  },
  "./package.json": "./package.json"
}
```

Package validation runs as part of `validate`: `publint` checks the exports map structure and `@arethetypeswrong/cli` checks type resolution across resolution modes.

### Git Hooks Architecture

Hooks are configured in `lefthook.yml` and implemented as Bun TypeScript files under `scripts/hooks/`:

- **pre-commit** (`lefthook.yml`, piped/sequential): formats staged files with Prettier, runs oxlint --fix on staged files, blocks staged conflict markers, and checks `bun.lock` is staged when `package.json` changes. Fast by design; skipped during merge/rebase.
- **pre-push** (`lefthook.yml`): runs full `bun run validate`; skipped in CI.
- **post-checkout** (`scripts/hooks/post-checkout.ts`): installs deps when `bun.lock` changes; surfaces config changes. Silent when nothing actionable changed.
- **post-merge** (`scripts/hooks/post-merge.ts`): installs/cleans when dependencies or config changed; flags leftover conflict markers. Silent when nothing actionable changed.

Hooks print only on failure (`output: [failure, execution_out]` in `lefthook.yml`), so a clean commit/push stays quiet. The TypeScript hook scripts import only Bun and Node built-ins (`node:util` `styleText` for color, Bun's `$` and `Bun.write` for shell/IO): hooks run in a fresh clone or worktree before `bun install`, so a package import would crash them. `test/hook-scripts.test.ts` enforces this.

### Claude Code Hooks

`.claude/settings.json` wires up two project-level Claude Code hooks (scripts in `.claude/hooks/`):

- **format-on-edit** (`PostToolUse` on `Edit`/`Write`): runs `prettier --write --ignore-unknown` on the file Claude just edited, so edits always match the project style and never trip the format gate. Fail-safe — no-ops if Prettier isn't installed yet.
- **protect-env** (`PreToolUse` on `Write`): blocks writes to `.env` / `.env.*` (except `.env.example`) so secrets aren't clobbered. Edit those files manually.

Both scripts exit 0 (no-op) when their dependencies are missing, so a freshly cloned template never breaks a session.

### Types

There is no shared `src/types.ts` in this template. Add shared or domain-specific types near their modules as needed.

## Development Patterns

### Adding New Features

1. **Exports**: Export every new schema, its inferred type, and (for a top-level schema) a type guard from `index.ts`, and document each in `README.md`. `public-api.test.ts` enforces all three.
2. **Types**: Domain-specific types live near their modules.

### Testing Approach

- Tests use Bun's built-in test runner with `describe`, `it`, `expect`.
- Test files are colocated with sources using the `.test.ts` suffix.
- `test/setup.ts` is preloaded by `bunfig.toml` — it resets mocks and system time in `afterEach`. All tests get this automatically.
- Oxlint rules are relaxed for test files. You can use `any`, non-null assertions, and other patterns normally flagged.
- A separate `tsconfig.test.json` provides relaxed TypeScript settings for tests (checked by `bun run typecheck:test`).
- Coverage threshold is 100% for `src/`. Run `bun test --coverage` to see the report.

### Import Organization

Keep imports in this order:

1. Bun built-ins (e.g., `import { file, write } from 'bun'`)
2. Node built-ins (e.g., `import { readFile } from 'node:fs'`)
3. External packages (e.g., `import { z } from 'zod'`)
4. Relative imports (e.g., `./local-module`)

No path alias (`@/*`) — use relative imports everywhere.

## Bun-Specific Considerations

- Always use `bun` commands, not `npm` or `yarn`.
- The lockfile in this repo is `bun.lock`.
- Bun provides native TypeScript execution without precompilation.
- For one-off package execution, use `bun x` for packages already in `devDependencies` rather than `bunx`, which can pull remote versions.

### Prefer Bun Built-ins Over Node

When possible, use Bun's native APIs in `scripts/` and tests. Do not use them in `src/` — published code must be Node-compatible.

| Task          | Use (Bun)                                | Avoid (Node)                     |
| ------------- | ---------------------------------------- | -------------------------------- |
| Read file     | `Bun.file(path).text()`                  | `fs.readFileSync(path, 'utf-8')` |
| Write file    | `Bun.write(path, data)`                  | `fs.writeFileSync(path, data)`   |
| HTTP server   | `Bun.serve()`                            | `http.createServer()` or Express |
| Hashing       | `Bun.hash()` or `new Bun.CryptoHasher()` | `crypto.createHash()`            |
| Spawn process | `Bun.spawn()` or `Bun.$`                 | `child_process.spawn()`          |
| Sleep         | `Bun.sleep(ms)`                          | `setTimeout` with promisify      |
| Environment   | `Bun.env.VAR`                            | `process.env.VAR`                |
| Glob          | `Bun.Glob`                               | `glob` package                   |

When a Bun equivalent doesn't exist or Node's API is more appropriate, use the `node:` prefix for clarity (e.g., `import { join } from 'node:path'`).

### Configuration Notes

- **bunfig.toml**: Configures the `.md` text loader, forces Bun runtime for scripts, and sets up `bun test` with preload, coverage, and 100% thresholds.
- **TypeScript**: Uses Bun types; Node type libs are not included by default.
- **Oxlint**: Rust-based linter with built-in TypeScript, promise, unicorn, and import plugins. Type-aware rules enabled via `--type-aware --tsconfig ./tsconfig.json`. Test files have relaxed rules.
- **Testing**: Run tests in parallel via `bun test --parallel`.
