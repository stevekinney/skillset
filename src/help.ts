/** Usage and per-command help text for the CLI. */

export const USAGE = `skillset — compile skills, agents, MCP servers, instructions, hooks, and
model defaults for Claude Code and Codex from one source root.

Usage:
  skillset [sync] [options]      Compile sources into both tools (default command)
  skillset doctor [--targets]    Validate sources, or audit managed outputs for drift
  skillset list                  List every source with its doctor status
  skillset show <name>           Preview a source's compiled per-target output
  skillset new <skill|agent> <name>       Scaffold a new source
  skillset remove <skill|agent> <name>    Delete a source
  skillset get <skill|agent> <name> [<field-path>]        Read frontmatter
  skillset set <skill|agent> <name> <field-path> <value>  Write one frontmatter field
  skillset import <skill|agent|instructions> [name]       Adopt an installed item
  skillset mcp                   Serve every command as MCP tools over stdio

Global options:
  --scope user|project   Write into the home directory (default) or this repo.
  --target claude|codex  Limit to one tool.
  --json                 Machine-readable output.
  -h, --help             Show help; use \`skillset <command> --help\` for details.

The source root is the current directory, or $SKILLSET_DIRECTORY when set.
Run \`skillset <command> --help\` for the full story on any command.`;

const SYNC_HELP = `skillset sync — compile every source into Claude Code and Codex config.

Usage:
  skillset [sync] [--dry-run] [--prune] [--force] [--scope user|project]
                  [--target claude|codex] [--kind <kind>] [--json]

Reads the source root and writes per-tool output: skills and agents as files,
MCP servers / hooks / defaults as surgical edits inside the tools' own config
files, instructions as CLAUDE.md / AGENTS.md. Validation runs first; any
error aborts the sync.

Ownership rules (what sync will and will not touch):
  - Outputs skillset generated are overwritten freely (marker + ledger).
  - Hand-installed items are skipped as "unmanaged".
  - Managed outputs hand-edited since the last sync are skipped as "drifted".
  - Both skips are loud, and --force overrides them.
  - Shared config files get a <file>.skillset-backup before the first write.

Options:
  --dry-run              Print the full action plan without touching disk.
  --prune                Remove generated outputs whose sources were deleted.
  --force                Overwrite unmanaged and drifted targets.
  --scope user|project   Home directory (default) or current repo.
  --target claude|codex  Limit to one tool.
  --kind skills|agents|mcp|instructions|hooks|defaults
                         Limit to one source kind (pruning is scoped too).
  --json                 Emit the action plan as JSON.

Examples:
  skillset sync --dry-run          Preview everything.
  skillset --kind hooks --force    Re-apply hooks, overwriting drifted entries.
  skillset sync --scope project    Compile into this repo's .claude/.codex dirs.`;

const DOCTOR_HELP = `skillset doctor — validate sources, or audit managed outputs.

Usage:
  skillset doctor [--json]
  skillset doctor --targets [--scope user|project] [--json]

Without --targets, checks every source: name/description constraints,
frontmatter schemas, template directives, MCP transport coherence, hook event
validity, and Claude-only features that will be rewritten for Codex. Errors
exit 1 and block sync; warnings do not.

With --targets, checks the other direction: every output recorded in the
sync ledger is compared against disk and reported as
  clean    byte-identical to what skillset last wrote
  drift    hand-edited since the last sync (sync will skip it; see --force)
  missing  deleted or its config entry removed
Exits 1 when anything is not clean. Run it before syncing on a machine where
compiled output may have been tweaked by hand.

Examples:
  skillset doctor --json
  skillset doctor --targets --scope project`;

const LIST_HELP = `skillset list — list every source with its doctor status.

Usage:
  skillset list [--json]

One row per skill, agent, and MCP server: kind, name, and ok / warnings /
errors. JSON shape: [{kind, name, status}].`;

const SHOW_HELP = `skillset show — preview a source's compiled output.

Usage:
  skillset show <name> [--target claude|codex] [--json]

Compiles the named skill, agent, or MCP server in memory and prints what each
tool would receive — including frontmatter projection, Codex prose fallbacks,
agents/openai.yaml, and MCP config mappings. Nothing is written.

Examples:
  skillset show my-skill --target codex
  skillset show neon --json`;

const NEW_HELP = `skillset new — scaffold a source.

Usage:
  skillset new <skill|agent> <name>

Creates skills/<name>/SKILL.md or agents/<name>.md with doctor-clean starter
frontmatter. Names must be lowercase alphanumeric with hyphens. Refuses to
overwrite an existing source.`;

const REMOVE_HELP = `skillset remove — delete a source.

Usage:
  skillset remove <skill|agent> <name>

Deletes the whole skill directory or the agent file. Generated outputs stay
in place until you run \`skillset sync --prune\`.`;

const GET_HELP = `skillset get — read frontmatter.

Usage:
  skillset get <skill|agent> <name> [<field-path>] [--json]

Without a field path, prints the whole frontmatter mapping. With one, prints
that field via dot notation (e.g. openai.interface.display_name, codex.model).

Examples:
  skillset get skill my-skill
  skillset get agent reviewer codex.model --json`;

const SET_HELP = `skillset set — write one frontmatter field.

Usage:
  skillset set <skill|agent> <name> <field-path> <value>

The value is parsed as YAML — \`true\` becomes a boolean, \`5\` a number,
\`[a, b]\` a list; quote values that must stay strings. The write is
validated against the union schema first and rejected if invalid. An empty
value deletes the field. The markdown body is never touched.

Examples:
  skillset set skill my-skill model sonnet
  skillset set skill my-skill disable-model-invocation true
  skillset set agent reviewer codex.sandbox_mode read-only
  skillset set skill my-skill openai ''       # delete the openai block`;

const IMPORT_HELP = `skillset import — adopt an installed item into the source tree.

Usage:
  skillset import <skill|agent> <name> [--from claude|codex] [--scope user|project]
  skillset import instructions [--from claude|codex]

Reverse-compiles an existing installed item into a source file: Claude skills
and agents copy over with the generated marker stripped; Codex skills fold
agents/openai.yaml into the \`openai:\` frontmatter block; Codex agent TOML
becomes union frontmatter with the body from developer_instructions;
instructions imports CLAUDE.md (or AGENTS.md with --from codex).

After writing the source, the item is force-synced so the pre-existing
targets gain markers and ledger entries — from then on skillset manages them.
Refuses to overwrite an existing source. If the imported source has doctor
errors, it is left in place unadopted (exit 1) so you can fix and sync.

Examples:
  skillset import skill typescript-authoring
  skillset import agent helper --from codex
  skillset import instructions`;

const MCP_HELP = `skillset mcp — serve skillset as an MCP server over stdio.

Usage:
  skillset mcp

Speaks the Model Context Protocol on stdin/stdout, exposing every skillset
operation as a tool: list_sources, run_doctor, check_targets, sync,
show_source, new_source, remove_source, get_field, set_field, and
import_source. Tool results use the same JSON shapes as the CLI's --json
output. The server runs until its stdin closes.

Register it with the tools themselves, e.g.:
  claude mcp add skillset -- skillset mcp
  codex mcp add skillset -- skillset mcp

The sync tool honors the same ownership rules as the CLI (unmanaged and
drifted outputs are skipped unless force is set), so giving an agent this
server does not let it silently clobber hand-written config.`;

const COMMAND_HELP: Record<string, string> = {
  sync: SYNC_HELP,
  doctor: DOCTOR_HELP,
  list: LIST_HELP,
  show: SHOW_HELP,
  new: NEW_HELP,
  remove: REMOVE_HELP,
  get: GET_HELP,
  set: SET_HELP,
  import: IMPORT_HELP,
  mcp: MCP_HELP,
};

/** The help text for one command, or undefined for unknown commands. */
export function commandHelp(command: string): string | undefined {
  return COMMAND_HELP[command];
}
