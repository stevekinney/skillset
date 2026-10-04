import { join } from 'node:path';

import { discover } from './workflow-schema-discovery.js';
import { checkScripts } from './workflow-schema-scripts.js';
import { home, printReport } from './workflow-schema-tally.js';
import { checkRecords, checkTranscripts } from './workflow-schema-transcripts.js';

/**
 * Checks the Claude Code workflow schemas against every workflow on this
 * machine: saved scripts (`~/.claude/projects/<project>/<session>/workflows/scripts`,
 * `~/.claude/workflows`, and every `.claude/workflows` directory under the
 * scanned roots), the `wf_<id>.json` run records beside them, and the
 * `Workflow` tool calls and results inside session transcripts.
 *
 * Inline scripts are also checked against the runtime's own verdict: the tool
 * result that follows each call says whether Claude Code accepted the script,
 * so a script this package rejects must have been rejected there too, and the
 * other way round.
 *
 * Output is limited to structure names, counts, schema issue paths and codes,
 * and file:line locations. It never prints script, prompt, or record content.
 *
 * Exits non-zero when anything fails. Warnings (phase titles with no
 * `meta.phases` entry, files the runtime never ran) do not fail the run.
 *
 * Usage: bun run scripts/check-workflow-schema.ts [--root <directory>]... [--all]
 *
 * `--root` adds a directory to scan for `.claude/workflows` folders; the default
 * roots are `~/Developer` and `~/.agent-worktrees`. `CLAUDE_CONFIG_DIR` moves
 * `~/.claude`.
 */

const roots = process.argv.flatMap((argument, index) =>
  argument === '--root' ? [process.argv[index + 1] ?? ''] : [],
);
const found = await discover(
  roots.length > 0 ? roots : [join(home, 'Developer'), join(home, '.agent-worktrees')],
);
console.log(
  `Found ${found.scripts.length} script files, ${found.records.length} run records, ` +
    `${found.transcripts.length} session transcripts, and ${found.nearMisses} files the runtime skips (.mjs, .cjs, .ts).`,
);

const executed = await checkRecords(found.records);
await checkScripts(found.scripts, executed);
await checkTranscripts(found.transcripts);
process.exit(printReport());
