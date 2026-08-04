# UI readiness

What a web UI for skillset needs from this tooling, what already exists after
milestone 3, and what remains. The working assumption: a Svelte 5 app built on
`@lostgradient/cinder`, managing skills, agents, MCP servers, instructions,
hooks, and defaults visually. This document is the contract the CLI maintains
so that UI can be built without re-plumbing the core.

## Architecture recommendation

Keep the UI in this repository as a workspace that consumes `skillset` as a
library. Every screen the UI needs maps onto functions this package already
exports (`analyzeSources`, `planSync`/`executeSync`, the `*-apply` modules,
`listEntries`, `showSource`, `newSource`/`setField`/`removeSource`,
`importSource`, `itemStatus`), and the Zod schemas in `frontmatter.ts` /
`agent-frontmatter.ts` / `mcp-config.ts` / `hooks-config.ts` /
`defaults-config.ts` are the single source of truth for form validation —
`z.toJSONSchema` can feed them straight into form generation. A separate
repository only makes sense if the UI's release cadence diverges hard from the
CLI's; starting split guarantees schema drift for no benefit.

The serving layer should be a thin `skillset serve` command (not yet built):
`Bun.serve` in `scripts/` or a dedicated entry, exposing the JSON contracts
below over HTTP for the local UI. No remote deployment story is needed — this
is a localhost tool operating on the user's own config files.

## The three data layers (all implemented)

1. **Sources** — the user's editable truth (`skills/`, `agents/`,
   `mcp-servers.yaml`, `instructions.md`, `hooks.yaml`, `defaults.yaml`).
   The UI reads these through `analyzeSources` (which also yields per-item
   doctor issues) and mutates them through `newSource`/`setField`/
   `removeSource` or direct file edits. Union frontmatter means the UI edits
   one document per item, never two dialects.

2. **The ledger** (`~/.config/skillset/state.json`, version 2) — machine
   state: for every managed output, its kind, name, scope, target, a
   `sha256:` hash of what was last written (per emitted file for directory
   kinds), the exact managed entry for config-embedded kinds, and a
   `syncedAt` ISO timestamp. This powers sync-status badges, "last synced"
   columns, and drift indicators without recompiling anything. The ledger is
   append-per-sync, keyed by target path (`<path>` or
   `<config>#<kind>:<name>`), and versioned for future migration.

3. **Targets** — the tools' real config, only ever touched through the
   marker/ledger ownership rules. The UI never edits these directly; it
   requests syncs.

## JSON contracts (implemented)

Every command takes `--json`; these shapes are the UI's data layer v0 and
should only change additively:

- `list --json` → `[{kind, name, status: ok|warnings|errors}]`
- `doctor --json` → `{skills: [{name, issues}], agents: [{name, issues}], files: {<filename>: issues}}`
  where an issue is `{severity: error|warning, message}`
- `doctor --targets --json` → `[{kind, name, scope, target, hash, syncedAt, path, status: clean|drift|missing}]`
- `sync [--dry-run] --json` → `{dryRun, scope, actions: [{target, kind, name, path, action: write|overwrite|skip-unmanaged|skip-drifted|prune, scope}]}`
- `show <name> --json` → `[{target, label, contents}]` (compiled previews)
- `get <kind> <name> --json` → the frontmatter mapping (or one field)

A dry-run sync followed by a real sync is exactly the UI's "review changes →
apply" flow; `skip-drifted` rows are the confirmation dialogs.

## Display metadata convention (documented, ready to use)

UI-facing presentation data lives in the spec-sanctioned `metadata:`
frontmatter map, namespaced with a `skillset.` prefix so it never collides
with either tool or other agentskills consumers:

```yaml
metadata:
  skillset.category: research
  skillset.tags: git, review
  skillset.icon: magnifying-glass
  skillset.accent: '#7C3AED'
```

Rationale: it travels with the source (survives import/export and version
control), is valid for both tools (both treat `metadata` as free-form), and
requires no sidecar manifest that could drift. The doctor already tolerates
arbitrary `metadata` keys. MCP servers, hooks, and defaults are entries in
single YAML files; if they need display metadata later, the same namespaced
keys can live alongside each entry (the schemas would gain an optional
`metadata` field — additive change).

## What the UI needs that the CLI does not yet provide

- **`skillset serve`** — the HTTP layer over the library: GET endpoints
  wrapping the JSON contracts, POST endpoints wrapping `newSource`,
  `setField`, `removeSource`, `importSource`, and plan/execute sync. All
  mutations already exist as tested functions; serve is routing plus input
  validation via the existing Zod schemas.
- **Change notification** — a watch mode (filesystem watching of the source
  root and target configs) pushing server-sent events so drift badges update
  live. `doctor --targets` is cheap enough to run on-change.
- **Per-item enable/disable** — Claude's `skillOverrides` setting and Codex's
  `skills.config` both support disabling a skill without deleting it. This is
  a natural seventh managed kind (same ledger/ownership machinery) and the
  UI's on/off toggle.
- **Conflict-safe editing** — the UI should re-run `analyzeSources` after
  every mutation rather than caching parses; source files are also edited by
  humans and agents.

## Invariants the UI may rely on

- Nothing skillset wrote is unidentifiable: file outputs carry a marker
  comment, config entries are recorded in the ledger.
- Sync never destroys hand-written content without `--force`; drifted managed
  outputs are skipped and reported.
- Every touched shared config file gets a `.skillset-backup` sibling before
  the first write of a run.
- The ledger is the only cross-run state; deleting it degrades gracefully
  (markers still prevent clobbering hand-installed files; drift detection
  falls back to "unverifiable, treated as managed").
