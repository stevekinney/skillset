import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { claudeWorkflowAgentOptionsSchema } from '../src/claude-workflow-agent-options.js';
import {
  checkClaudeWorkflowPhases,
  extractClaudeWorkflowCalls,
  type ClaudeWorkflowCalls,
} from '../src/claude-workflow-calls.js';
import {
  findClaudeWorkflowForbiddenApis,
  parseClaudeWorkflowMeta,
} from '../src/claude-workflow-source.js';
import { claudeWorkflowReferenceSchema } from '../src/claude-workflow-tool.js';
import {
  count,
  display,
  failures,
  note,
  schemaFindings,
  warnings,
  type Finding,
} from './workflow-schema-tally.js';

export type ScriptFindings = { failures: Finding[]; warnings: Finding[] };
type Calls = Extract<ClaudeWorkflowCalls, { ok: true }>;

function metaFindings(source: string): { failures: Finding[]; titles: string[] | undefined } {
  const meta = parseClaudeWorkflowMeta(source);
  if (meta.ok) return { failures: [], titles: (meta.meta.phases ?? []).map(({ title }) => title) };
  const error = meta.error.replace(/\(\d+:\d+\)/, '').trim();
  return {
    failures: [{ category: `meta (${error})`, line: meta.line, launchCheck: true }],
    titles: undefined,
  };
}

function forbiddenFindings(source: string): Finding[] {
  const forbidden = findClaudeWorkflowForbiddenApis(source);
  return forbidden.ok
    ? forbidden.usages.map((usage) => ({
        category: `forbidden ${usage.api}`,
        line: usage.line,
        launchCheck: true,
      }))
    : [];
}

function callFindings(calls: Calls): Finding[] {
  const found: Finding[] = [];
  for (const agent of calls.agents) {
    count('agent() options properties computed at runtime', agent.unresolvedProperties);
    const issues = schemaFindings(
      'agent() options',
      claudeWorkflowAgentOptionsSchema,
      agent.options,
    );
    found.push(...issues.map((issue) => ({ ...issue, line: agent.line })));
  }
  for (const call of calls.workflowReferences) {
    const issues = schemaFindings(
      'workflow() reference',
      claudeWorkflowReferenceSchema,
      call.reference,
    );
    found.push(...issues.map((issue) => ({ ...issue, line: call.line })));
  }
  count('agent() calls without literal options', calls.agentsWithoutLiteralOptions);
  count('workflow() references computed at runtime', calls.workflowReferencesUnresolved);
  return found;
}

/** Everything this package can say about one script's source. */
export function scriptFindings(source: string): ScriptFindings {
  const meta = metaFindings(source);
  const calls = extractClaudeWorkflowCalls(source);
  const found: ScriptFindings = {
    failures: [...meta.failures, ...forbiddenFindings(source)],
    warnings: [],
  };
  if (!calls.ok)
    return {
      ...found,
      failures: [...found.failures, { category: 'syntax', line: calls.line, launchCheck: true }],
    };

  found.failures.push(...callFindings(calls));
  if (meta.titles) {
    const check = checkClaudeWorkflowPhases(calls.phases, meta.titles);
    found.warnings = check.unlisted.map((use) => ({
      category: 'phase title with no meta.phases entry',
      line: use.line,
    }));
    count('phase titles computed at runtime', check.unverifiable.length);
  }
  return found;
}

/** Record a script's findings. A script the runtime never ran reports its failures as warnings. */
export function report(
  structure: string,
  found: ScriptFindings,
  location: (line?: number) => string,
  failuresAreWarnings = false,
) {
  for (const finding of found.failures)
    note(
      failuresAreWarnings ? warnings : failures,
      `${structure}: ${finding.category}`,
      location(finding.line),
    );
  for (const finding of found.warnings)
    note(warnings, `${structure}: ${finding.category}`, location(finding.line));
}

/**
 * Saved scripts. A file in a session's `scripts` directory that no run executed
 * (a partial or helper the agent wrote there) is not something the runtime
 * loads, so its findings are warnings.
 */
export async function checkScripts(
  files: Array<{ path: string; session: boolean }>,
  executed: Set<string>,
) {
  for (const { path, session } of files) {
    const ran = !session || executed.has(resolve(path)) || /-wf_[a-z0-9-]+\.js$/.test(path);
    count(ran ? 'saved scripts' : 'files in a scripts directory that no run executed');
    const found = scriptFindings(await readFile(path, 'utf8'));
    report(
      ran ? 'saved script' : 'unexecuted file',
      found,
      (line) => `${display(path)}:${line ?? 1}`,
      !ran,
    );
  }
}
