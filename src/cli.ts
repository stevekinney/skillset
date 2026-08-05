import { homedir } from 'node:os';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import chalk from 'chalk';

import {
  analysisHasErrors,
  analysisIssueFiles,
  analyzeSources,
  type Analysis,
} from './analysis.js';
import { runDoctorTargets, runImport, runSync, type RunContext } from './commands-run.js';
import {
  getField,
  listEntries,
  newSource,
  removeSource,
  renderValue,
  setField,
  showSource,
  type SourceKind,
} from './commands.js';
import { resolveSourceRoot } from './discover.js';
import { parseEnvironment } from './environment.js';
import { USAGE } from './help.js';
import { parseInvocation, type Invocation } from './invocation.js';
import { runMcpServer } from './mcp-server.js';
import { renderDoctor } from './render.js';

/**
 * Everything the CLI reads from the outside world, injectable so tests can
 * run entirely against temporary directories.
 */
export type CliDependencies = {
  cwd: string;
  env: Record<string, string | undefined>;
  homeDirectory: string;
  log: (line: string) => void;
  /** The transport `skillset mcp` serves on. Defaults to stdio. */
  mcpTransport?: Transport;
};

/** The runtime defaults: real cwd, env, home directory, and stdout. */
export function defaultDependencies(): CliDependencies {
  return {
    cwd: process.cwd(),
    env: process.env,
    homeDirectory: homedir(),
    log: (line) => process.stdout.write(`${line}\n`),
  };
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function runContext(dependencies: CliDependencies): RunContext {
  const skillsetDirectory = parseEnvironment(dependencies.env).SKILLSET_DIRECTORY;

  return {
    cwd: dependencies.cwd,
    homeDirectory: dependencies.homeDirectory,
    ...(skillsetDirectory === undefined ? {} : { skillsetDirectory }),
    log: dependencies.log,
  };
}

function renderAnalysis(analysis: Analysis, json: boolean, log: (line: string) => void): void {
  renderDoctor(
    {
      skillReports: analysis.skillReports,
      agentReports: analysis.agentReports,
      files: analysisIssueFiles(analysis),
    },
    json,
    log,
  );
}

async function runAnalyzedCommand(
  invocation: Invocation,
  dependencies: CliDependencies,
): Promise<number> {
  const context = runContext(dependencies);
  const analysis = await analyzeSources(context.skillsetDirectory, context.cwd);
  const { log } = dependencies;

  if (invocation.command === 'doctor') {
    renderAnalysis(analysis, invocation.json, log);

    return analysisHasErrors(analysis) ? 1 : 0;
  }

  if (invocation.command === 'sync') {
    if (analysisHasErrors(analysis)) {
      renderAnalysis(analysis, invocation.json, log);
      log(chalk.red('sync aborted — fix the errors above first'));

      return 1;
    }

    return runSync(invocation, analysis, context);
  }

  if (invocation.command === 'list') {
    const entries = listEntries(analysis.sources);
    if (invocation.json) {
      log(JSON.stringify(entries, undefined, 2));
    } else {
      for (const entry of entries) {
        const status = {
          ok: chalk.green('ok'),
          warnings: chalk.yellow('warnings'),
          errors: chalk.red('errors'),
        }[entry.status];
        log(`${entry.kind} ${entry.name} — ${status}`);
      }
    }

    return 0;
  }

  const files = showSource(analysis.sources, invocation.name!, invocation.targets);
  if (invocation.json) {
    log(JSON.stringify(files, undefined, 2));
  } else {
    for (const file of files) {
      log(chalk.bold(`── ${file.target}: ${file.label}`));
      log(file.contents.trimEnd());
    }
  }

  return 0;
}

async function runDirectCommand(
  invocation: Invocation,
  dependencies: CliDependencies,
): Promise<number> {
  const context = runContext(dependencies);
  const root = resolveSourceRoot(context.skillsetDirectory, context.cwd);
  const { log } = dependencies;
  const kind: SourceKind = invocation.sourceKind!;

  if (invocation.command === 'new') {
    log(`created ${await newSource(root, kind, invocation.name!)}`);
    return 0;
  }

  if (invocation.command === 'remove') {
    log(`removed ${await removeSource(root, kind, invocation.name!)}`);
    log('run `skillset sync --prune` to remove the generated outputs');
    return 0;
  }

  if (invocation.command === 'get') {
    const value = await getField(root, kind, invocation.name!, invocation.fieldPath);
    log(renderValue(value, invocation.json));
    return 0;
  }

  await setField(root, kind, invocation.name!, invocation.fieldPath!, invocation.value!);
  log(`set ${invocation.fieldPath} on ${kind} ${invocation.name}`);

  return 0;
}

/**
 * Run the CLI and return its exit code. All IO goes through `dependencies`.
 */
export async function runCli(argv: string[], dependencies: CliDependencies): Promise<number> {
  const invocation = parseInvocation(argv);

  if ('usageError' in invocation) {
    if (invocation.helpText !== undefined) {
      dependencies.log(invocation.helpText);

      return 0;
    }
    if (invocation.usageError !== '') dependencies.log(chalk.red(invocation.usageError));
    dependencies.log(USAGE);

    return invocation.usageError === '' ? 0 : 1;
  }

  try {
    return await dispatch(invocation, dependencies);
  } catch (cause) {
    dependencies.log(chalk.red(describeError(cause)));

    return 1;
  }
}

const DIRECT_COMMANDS = new Set(['new', 'remove', 'get', 'set']);

async function dispatch(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  if (invocation.command === 'mcp') {
    return runMcpServer(dependencies, dependencies.mcpTransport);
  }
  if (invocation.command === 'doctor' && invocation.checkTargets) {
    return runDoctorTargets(invocation, runContext(dependencies));
  }
  if (invocation.command === 'import') {
    return runImport(invocation, runContext(dependencies));
  }
  if (DIRECT_COMMANDS.has(invocation.command)) {
    return runDirectCommand(invocation, dependencies);
  }

  return runAnalyzedCommand(invocation, dependencies);
}

export type { SourceKind };
