import { z } from 'zod';

import type { Issue } from './doctor.js';
import { isMapping } from './frontmatter.js';
import { claudeMcpEntryProblems, type McpProblem, unknownClaudeMcpFields } from './mcp-schema.js';

function warning(message: string): Issue {
  return { severity: 'warning', message };
}

// Claude Code's own `claudeai-proxy` entry (the claude.ai connectors it manages
// itself). Its loader accepts the type from files, but it is not a transport an
// author writes by hand. Only the required fields are modelled.
const claudeAiProxySchema = z.looseObject({
  type: z.literal('claudeai-proxy'),
  url: z.string(),
  id: z.string(),
  displayName: z.string().optional(),
  iconUrl: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  alwaysLoad: z.boolean().optional(),
});

/**
 * One item of a Claude subagent's `mcpServers` list, as read from frontmatter.
 * Claude Code validates each item when it loads the agent file, logs an
 * invalid one, drops it, and still loads the agent. So the schema accepts any
 * item and `claudeAgentMcpItemProblems` reports what Claude would drop.
 */
export const claudeAgentMcpServerSchema = z.unknown();

/**
 * Why Claude Code would drop one subagent `mcpServers` item: it is either the
 * name of an already-configured server, or a mapping from a server name to a
 * full inline entry. Claude Code requires exactly one key per mapping at load
 * time rather than in its schema, so doctor reports that rule separately.
 */
export function claudeAgentMcpItemProblems(item: unknown): McpProblem[] {
  if (typeof item === 'string') return [];

  if (!isMapping(item)) {
    return [
      { path: [], message: 'expected a server name or a mapping of one server name to its entry' },
    ];
  }

  const problems: McpProblem[] = [];

  for (const [name, entry] of Object.entries(item)) {
    if (!isMapping(entry)) {
      problems.push({ path: [name], message: 'expected a server entry' });
      continue;
    }

    if (entry['type'] === 'claudeai-proxy') {
      const result = claudeAiProxySchema.safeParse(entry);
      problems.push(
        ...(result.success ? [] : result.error.issues).map((issue) => ({
          path: [name, ...issue.path],
          message: issue.message,
        })),
        {
          path: [name, 'type'],
          message:
            '`claudeai-proxy` is a claude.ai connector that Claude Code manages itself, not a user-authored transport — use stdio, sse, http, or ws',
        },
      );
      continue;
    }

    for (const problem of claudeMcpEntryProblems(entry)) {
      problems.push({ path: [name, ...problem.path], message: problem.message });
    }
  }

  return problems;
}

function describeInlineProblem(problem: McpProblem): string {
  const path = problem.path.map(String).join('.');

  return path ? `${path}: ${problem.message}` : problem.message;
}

export function checkInlineMcpServer(index: number, item: unknown): Issue[] {
  if (typeof item === 'string') return [];

  const issues = claudeAgentMcpItemProblems(item).map((problem) =>
    warning(
      `mcpServers[${index}] ${describeInlineProblem(problem)} — Claude Code logs the problem, drops this item, and still loads the agent`,
    ),
  );
  if (!isMapping(item)) return issues;

  const names = Object.keys(item);

  if (names.length !== 1) {
    issues.push(
      warning(
        `mcpServers[${index}] has ${names.length} keys — Claude Code requires exactly one server name per inline item and drops it otherwise`,
      ),
    );
  }

  for (const [serverName, entry] of Object.entries(item)) {
    if (!isMapping(entry)) continue;

    for (const field of unknownClaudeMcpFields(entry)) {
      issues.push(
        warning(
          `mcpServers[${index}] server \`${serverName}\` has unknown field \`${field}\` — Claude Code ignores it for this transport`,
        ),
      );
    }
  }

  return issues;
}
