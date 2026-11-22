# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential commands

Use Bun 1.4.0 locally to match the [CI matrix](.github/workflows/ci.yaml), which checks Node 22 and 24 on Linux, macOS, and Windows.

| Command                               | Purpose                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile`       | Install dependencies and register Lefthook through `prepare`.                  |
| `bun run check`                       | Run `format:check`, `lint`, and `typecheck`.                                   |
| `bun run validate`                    | Run formatting, lint, both type checks, tests, build, and both package checks. |
| `bun test`                            | Run the suite. Pass a path or `-t <pattern>` to narrow the run.                |
| `bun test --watch`                    | Rerun tests when files change.                                                 |
| `bun run test:coverage`               | Run tests with coverage reporting.                                             |
| `bun run format` / `bun run lint:fix` | Apply formatting or lint fixes.                                                |
| `bun run typecheck:test`              | Check the test TypeScript project.                                             |
| `bun run build`                       | Build ESM, TypeScript declarations, and standalone JSON Schemas.               |
| `bun run tsc`                         | Invoke the local TypeScript compiler directly.                                 |
| `bun run package:check`               | Check the built package, then verify the packed export map.                    |
| `bun run verify:package-types`        | Check the package from an isolated consumer install.                           |
| `bun run clean`                       | Remove `dist/`, generated `schemas/`, coverage, and TypeScript build caches.   |

See the [README development commands](README.md#development) for provider drift, Claude Mod declarations, and corpus checks. The [shared maintenance skill](.agents/skills/maintain-provider-compatibility/SKILL.md) covers how to verify and record drift.

## Architecture Overview

`skillset` is a pure library: Zod schemas, type guards, and validators for Claude Code's and Codex's configuration and runtime formats. The runtime library accepts text or parsed data. Callers own filesystem, network, and environment access. See `README.md` for the public API and `.claude/skills/tool-format-reference` for the verified facts each schema encodes.

### Module Layout (`src/`)

- `index.ts` — the public API. `public-api.test.ts` fails if a module exports a schema `index.ts` doesn't, if a public schema has no inferred type, or if a public export or package subpath is missing from `README.md`.
- `entry-hooks.ts` / `entry-sessions.ts` / `entry-workflows.ts` — the `./hooks`, `./sessions`, and `./workflows` subpath entry points. Each re-exports a slice of `index.ts`; `public-api.test.ts` checks each is a subset of the root, and the build uses `splitting` so they share one copy of each schema and error class.
- `frontmatter.ts` — Claude Code's and Codex's SKILL.md frontmatter schemas, `agents/openai.yaml`, the two effort schemas, and `parseClaudeSkillMapping`/`parseCodexSkillMapping`.
- `agent-frontmatter.ts` — Claude Code's subagent frontmatter schema, the Codex agent file schema (loose: it may carry any config.toml key), and `parseClaudeAgentMapping`.
- `validate-metadata.ts` — `validateSkillMetadata`/`validateSubagentMetadata`: split one file with `splitFrontmatterBlock` from `frontmatter-block.ts` (gray-matter 4's splitting rules, js-yaml's safe loader, executable fences refused, no Node APIs so it runs in browsers), validate against the target tool's schema, then run the rules in `doctor.ts`.
- `frontmatter-block.ts` — `splitFrontmatterBlock`, which splits a file at its `---` fences exactly as gray-matter 4 did, without gray-matter's `Buffer` use. `frontmatter-block.test.ts` checks it against gray-matter (a dev dependency kept only for that comparison).
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
- `type-guards.ts` holds schema-backed guards for standalone schemas and keyed maps. The guards narrow to `z.input`. Inferred public types describe parsed output.
- `byte-order-mark.ts` — `withoutByteOrderMark`, used before parsing any user-editable file.

### Core Design Principles

1. **Pure and side-effect free**: no filesystem, network, or environment access in `src/`, and nothing runs at import. Callers read files and pass in their text.

2. **Verified, not guessed**: every schema field and rule comes from what the tool actually accepts (binary schemas, published schemas, docs). Follow `.claude/skills/maintain-provider-compatibility` before adding or removing one, and record the result in `tool-format-reference`. Where acceptance is unverified, prefer a warning over an error.

3. **Runtime-Neutral Published Code**: `src/` must not use Bun-only runtime APIs (`Bun.file`, `Bun.env`, `Bun.serve`, etc.). Those APIs are fine in `scripts/` and test files, but must not appear in published library output.

### Key Notes

- **ESM + TypeScript**: Source files are TypeScript modules; build output targets both Node and Bun.
- **Import paths**: Use standard TS/ESM imports; no `@/*` path alias (it leaks into `.d.ts` files).
- **Library output**: Dual-emit — `dist/node/` for Node consumers, `dist/bun/` for Bun consumers. The `exports` map routes consumers automatically.

### Library packaging

`scripts/build.ts` emits split ESM bundles in `dist/node/` and `dist/bun/`, with shared declarations in `dist/`. The root and domain subpaths share chunked schema and error-class bindings within each build. `package.json` is the source of truth for the root, `/hooks`, `/sessions`, `/workflows`, `/workflow-globals`, manifest, and JSON Schema export paths.

`scripts/provider-json-schemas.ts` builds `schemas/claude-code.json` and `schemas/codex.json` from exported Zod schemas and keyed schema maps. The files are generated package artifacts. Adjust their source schemas and rerun the build to change them. The registry keeps each file self-contained with local references, and the workflow budget schema stays in the JavaScript API because it includes methods.

`bun run package:check` runs [publint](https://publint.dev/) and uses `bun pm pack` to hand an actual tarball to [Are The Types Wrong?](https://github.com/arethetypeswrong/arethetypeswrong.github.io). Passing the tarball directly avoids nested npm packing inside the publish lifecycle. `bun run verify:package-types` installs the tarball into a temporary npm consumer project, checks declarations with `skipLibCheck: false`, and exercises the published subpaths, workflow globals, schema and guard pairs in Node and Bun, and standalone JSON Schemas in a Draft 2020-12 validator.

### Release workflow

[GitHub Actions](.github/workflows/release.yaml) runs on a `vX.Y.Z` tag. The tag must match `package.json` as checked by `bun run verify:release-version --tag=vX.Y.Z`. The workflow installs dependencies, runs `preflight:publish` and `validate`, and publishes through npm trusted publishing with provenance before creating a GitHub release. Local npm lifecycle hooks use `prepare` for Git hook setup, `prepack` to build artifacts, and `prepublishOnly` to run preflight and full validation. CI runs those gates explicitly before publishing to keep the trusted-publishing token valid for the upload.

### Git Hooks Architecture

Hooks are configured in `lefthook.yml` and implemented as Bun TypeScript files under `scripts/hooks/`:

- **pre-commit** (`lefthook.yml`, piped/sequential): formats staged files with Prettier, runs oxlint --fix on staged files, blocks staged conflict markers, and checks `bun.lock` is staged when `package.json` changes. Fast by design; skipped during merge/rebase.
- **pre-push** (`lefthook.yml`): runs full `bun run validate`; skipped in CI.
- **post-checkout** (`scripts/hooks/post-checkout.ts`): installs deps when `bun.lock` changes; surfaces config changes. Silent when nothing actionable changed.
- **post-merge** (`scripts/hooks/post-merge.ts`): installs/cleans when dependencies or config changed; flags leftover conflict markers. Silent when nothing actionable changed.

Hooks print only on failure (`output: [failure, execution_out]` in `lefthook.yml`), so a clean commit/push stays quiet. The TypeScript hook scripts import only Bun and Node built-ins (`node:util` `styleText` for color, Bun's `$` and `Bun.write` for shell/IO): hooks run in a fresh clone or worktree before `bun install`, so a package import would crash them. `test/hook-scripts.test.ts` enforces this.

### Claude Code Hooks

`.claude/settings.json` wires up two project-level Claude Code hooks (scripts in `.claude/hooks/`):

- **format-on-edit** (`PostToolUse` on `Edit`/`Write`): runs `prettier --write --ignore-unknown` on the file Claude just edited, when `jq` and the local Prettier executable are available. The hook lets edits proceed if formatting fails.
- **protect-env** (`PreToolUse` on `Write`): blocks writes to `.env` / `.env.*` (except `.env.example`) so secrets aren't clobbered. Edit those files manually.

Both hooks skip their work when `jq` is unavailable.

### Types

Keep public types beside the schemas or domain modules that define them.

## Development Patterns

### Adding New Features

Export public schemas, inferred types, and guards from `index.ts` and the relevant domain entry point. For public schema maps, include the keyed type and guard. Document each in the README. The source API test checks coverage and the packed consumer check verifies that each schema, type, and guard agrees.

### Testing Approach

- Tests use Bun's built-in test runner with `describe`, `it`, `expect`.
- Test files are colocated with sources using the `.test.ts` suffix.
- `test/setup.ts` is preloaded by `bunfig.toml` — it resets mocks and system time in `afterEach`. All tests get this automatically.
- Oxlint rules are relaxed for test files. You can use `any`, non-null assertions, and other patterns normally flagged.
- A separate `tsconfig.test.json` provides relaxed TypeScript settings for tests (checked by `bun run typecheck:test`).
- Coverage is reported by default. See `bunfig.toml` for the configured thresholds.

### Import Organization

Keep imports in this order:

1. Bun built-ins (e.g., `import { file, write } from 'bun'`)
2. Node built-ins (e.g., `import { readFile } from 'node:fs'`)
3. External packages (e.g., `import { z } from 'zod'`)
4. Relative imports (e.g., `./local-module`)

No path alias (`@/*`) — use relative imports everywhere.

## Bun-Specific Considerations

- Use `bun` for development and dependency installation. Package validation uses npm to exercise the same install path as npm consumers.
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
