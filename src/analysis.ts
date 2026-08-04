import {
  checkDefaultsSource,
  parseDefaultsSource,
  type DefaultsSource,
} from './defaults-config.js';
import { discoverSources, resolveSourceRoot, type Sources } from './discover.js';
import {
  checkAgents,
  checkSkills,
  hasErrors,
  type AgentReport,
  type Issue,
  type SkillReport,
} from './doctor.js';
import { checkHooksSource, parseHooksSource, type HooksSource } from './hooks-config.js';
import { checkInstructions } from './instructions.js';
import { checkMcpSource, parseMcpSource, type ParsedMcpSource } from './mcp-config.js';
import type { CompilableSources } from './sync.js';

/** Everything a command needs to know about the source tree's health. */
export type Analysis = {
  sources: Sources;
  skillReports: SkillReport[];
  agentReports: AgentReport[];
  mcpIssues: Issue[];
  instructionsIssues: Issue[];
  hooksIssues: Issue[];
  defaultsIssues: Issue[];
  compilable: CompilableSources;
  mcpSource?: ParsedMcpSource;
  hooksSource?: HooksSource;
  defaultsSource?: DefaultsSource;
};

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Discover and validate every source kind under the root. Parse failures for
 * the single-file kinds become error issues rather than throws so the doctor
 * can report them all at once.
 */
export async function analyzeSources(
  skillsetDirectory: string | undefined,
  workingDirectory: string,
): Promise<Analysis> {
  const root = resolveSourceRoot(skillsetDirectory, workingDirectory);
  const sources = await discoverSources(root);

  const skillReports = checkSkills(sources.skills);
  const agentReports = checkAgents(sources.agents);

  const compilable: CompilableSources = { skills: [], agents: [] };
  for (const [index, report] of skillReports.entries()) {
    if (report.parsed) {
      compilable.skills.push({ source: sources.skills[index]!, parsed: report.parsed });
    }
  }
  for (const [index, report] of agentReports.entries()) {
    if (report.parsed) {
      compilable.agents.push({ source: sources.agents[index]!, parsed: report.parsed });
    }
  }

  const analysis: Analysis = {
    sources,
    skillReports,
    agentReports,
    mcpIssues: [],
    instructionsIssues: [],
    hooksIssues: [],
    defaultsIssues: [],
    compilable,
  };
  analyzeMcp(analysis);
  analyzeInstructions(analysis);
  analyzeHooks(analysis);
  analyzeDefaults(analysis);

  return analysis;
}

function analyzeMcp(analysis: Analysis): void {
  if (!analysis.sources.mcp) return;

  try {
    analysis.mcpSource = parseMcpSource(analysis.sources.mcp.raw);
    analysis.mcpIssues = checkMcpSource(analysis.mcpSource);
  } catch (cause) {
    analysis.mcpIssues = [
      { severity: 'error', message: `invalid mcp-servers.yaml — ${describeError(cause)}` },
    ];
  }
}

function analyzeInstructions(analysis: Analysis): void {
  if (!analysis.sources.instructions) return;

  analysis.instructionsIssues = checkInstructions(analysis.sources.instructions.raw);
  if (!analysis.instructionsIssues.some((issue) => issue.severity === 'error')) {
    analysis.compilable.instructions = analysis.sources.instructions.raw;
  }
}

function analyzeHooks(analysis: Analysis): void {
  if (!analysis.sources.hooks) return;

  try {
    analysis.hooksSource = parseHooksSource(analysis.sources.hooks.raw);
    analysis.hooksIssues = checkHooksSource(analysis.hooksSource);
  } catch (cause) {
    analysis.hooksIssues = [
      { severity: 'error', message: `invalid hooks.yaml — ${describeError(cause)}` },
    ];
  }
}

function analyzeDefaults(analysis: Analysis): void {
  if (!analysis.sources.defaults) return;

  try {
    analysis.defaultsSource = parseDefaultsSource(analysis.sources.defaults.raw);
    analysis.defaultsIssues = checkDefaultsSource(analysis.defaultsSource);
  } catch (cause) {
    analysis.defaultsIssues = [
      { severity: 'error', message: `invalid defaults.yaml — ${describeError(cause)}` },
    ];
  }
}

function issueGroups(analysis: Analysis): Issue[][] {
  return [
    ...analysis.skillReports.map((report) => report.issues),
    ...analysis.agentReports.map((report) => report.issues),
    analysis.mcpIssues,
    analysis.instructionsIssues,
    analysis.hooksIssues,
    analysis.defaultsIssues,
  ];
}

/** True when any source has an error-severity issue. */
export function analysisHasErrors(analysis: Analysis): boolean {
  return (
    hasErrors(analysis.skillReports) ||
    hasErrors(analysis.agentReports) ||
    issueGroups(analysis)
      .flat()
      .some((issue) => issue.severity === 'error')
  );
}
