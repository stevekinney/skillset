import chalk from 'chalk';

import { analysisHasErrors, analyzeSources, type Analysis } from './analysis.js';
import type { EmbeddedAction } from './config-files.js';
import { executeDefaultsApply, planDefaultsApply } from './defaults-apply.js';
import { resolveSourceRoot } from './discover.js';
import { itemStatus, type TargetStatus } from './drift.js';
import { executeHooksApply, planHooksApply } from './hooks-apply.js';
import { importSource } from './import.js';
import type { Invocation, KindFilter } from './invocation.js';
import { readLedger, writeLedger, type Ledger, type LedgerItem } from './ledger.js';
import { executeMcpApply, planMcpApply } from './mcp-apply.js';
import { renderEmbeddedAction, renderSyncAction } from './render.js';
import { executeSync, planSync, type SyncAction } from './sync.js';
import { resolveTargets, type Targets } from './targets.js';

/** What the command runners need from the outside world. */
export type RunContext = {
  cwd: string;
  homeDirectory: string;
  skillsetDirectory?: string | undefined;
  log: (line: string) => void;
};

function contextTargets(invocation: Invocation, context: RunContext): Targets {
  return resolveTargets(invocation.scope, context.homeDirectory, context.cwd);
}

async function contextLedger(context: RunContext, targets: Targets): Promise<Ledger> {
  const userTargets = resolveTargets('user', context.homeDirectory, context.cwd);

  return readLedger(targets.ledgerFile, {
    claudeMcpConfig: userTargets.claude.mcpConfig,
    codexMcpConfig: userTargets.codex.mcpConfig,
  });
}

type SyncScope = {
  fileKinds: ('skill' | 'agent' | 'instructions')[];
  mcp: boolean;
  hooks: boolean;
  defaults: boolean;
};

function syncScope(kind: KindFilter | undefined): SyncScope {
  if (kind === undefined) {
    return {
      fileKinds: ['skill', 'agent', 'instructions'],
      mcp: true,
      hooks: true,
      defaults: true,
    };
  }

  return {
    fileKinds:
      kind === 'skills'
        ? ['skill']
        : kind === 'agents'
          ? ['agent']
          : kind === 'instructions'
            ? ['instructions']
            : [],
    mcp: kind === 'mcp',
    hooks: kind === 'hooks',
    defaults: kind === 'defaults',
  };
}

type SyncPlan = {
  actions: SyncAction[];
  embedded: EmbeddedAction[];
};

async function planAll(
  invocation: Invocation,
  analysis: Analysis,
  targets: Targets,
  ledger: Ledger,
): Promise<SyncPlan> {
  const scope = syncScope(invocation.kind);
  const options = {
    targets: invocation.targets,
    scope: invocation.scope,
    prune: invocation.prune,
    force: invocation.force,
  };

  const actions = await planSync(analysis.compilable, targets, ledger, {
    targets: invocation.targets,
    kinds: scope.fileKinds,
    prune: invocation.prune,
    force: invocation.force,
  });

  const embedded: EmbeddedAction[] = [];
  const mcpFiles = { claude: targets.claude.mcpConfig, codex: targets.codex.mcpConfig };
  const hookFiles = { claude: targets.claude.hooksConfig, codex: targets.codex.hooksConfig };
  const defaultsFiles = {
    claude: targets.claude.defaultsConfig,
    codex: targets.codex.defaultsConfig,
  };

  if (scope.mcp && (analysis.mcpSource || invocation.prune)) {
    embedded.push(...(await planMcpApply(analysis.mcpSource, mcpFiles, ledger, options)));
  }
  if (scope.hooks && (analysis.hooksSource || invocation.prune)) {
    embedded.push(...(await planHooksApply(analysis.hooksSource, hookFiles, ledger, options)));
  }
  if (scope.defaults && (analysis.defaultsSource || invocation.prune)) {
    embedded.push(
      ...(await planDefaultsApply(analysis.defaultsSource, defaultsFiles, ledger, options)),
    );
  }

  return { actions, embedded };
}

async function executeAll(
  invocation: Invocation,
  analysis: Analysis,
  targets: Targets,
  ledger: Ledger,
  plan: SyncPlan,
): Promise<void> {
  const backedUp = new Set<string>();
  const byKind = (kind: EmbeddedAction['kind']): EmbeddedAction[] =>
    plan.embedded.filter((action) => action.kind === kind);

  await executeSync(analysis.compilable, plan.actions, ledger, invocation.scope);
  await executeMcpApply(
    analysis.mcpSource,
    byKind('mcp-server'),
    { claude: targets.claude.mcpConfig, codex: targets.codex.mcpConfig },
    ledger,
    invocation.scope,
    backedUp,
  );
  await executeHooksApply(
    analysis.hooksSource,
    byKind('hook'),
    { claude: targets.claude.hooksConfig, codex: targets.codex.hooksConfig },
    ledger,
    invocation.scope,
    backedUp,
  );
  await executeDefaultsApply(
    analysis.defaultsSource,
    byKind('default'),
    { claude: targets.claude.defaultsConfig, codex: targets.codex.defaultsConfig },
    ledger,
    invocation.scope,
    backedUp,
  );

  await writeLedger(targets.ledgerFile, ledger);
}

function renderPlan(invocation: Invocation, plan: SyncPlan, log: (line: string) => void): void {
  if (invocation.json) {
    const rows = [
      ...plan.actions.map((action) => ({ ...action, scope: invocation.scope })),
      ...plan.embedded.map((action) => ({
        target: action.target,
        kind: action.kind,
        name: action.name,
        path: action.file,
        action: action.action,
        scope: invocation.scope,
      })),
    ];
    log(
      JSON.stringify(
        { dryRun: invocation.dryRun, scope: invocation.scope, actions: rows },
        undefined,
        2,
      ),
    );
    return;
  }

  if (invocation.dryRun) log(chalk.bold('dry run — no files written'));
  for (const action of plan.actions) log(renderSyncAction(action));
  for (const action of plan.embedded) log(renderEmbeddedAction(action));

  const rewritesCodexHooks = plan.embedded.some(
    (action) =>
      action.kind === 'hook' &&
      action.target === 'codex' &&
      (action.action === 'write' || action.action === 'overwrite' || action.action === 'prune'),
  );
  if (rewritesCodexHooks && !invocation.dryRun) {
    log(chalk.yellow('codex hook config changed — re-trust the hooks via /hooks in Codex'));
  }
}

/** Run `skillset sync`: plan everything, execute unless dry-run, report. */
export async function runSync(
  invocation: Invocation,
  analysis: Analysis,
  context: RunContext,
): Promise<number> {
  const targets = contextTargets(invocation, context);
  const ledger = await contextLedger(context, targets);
  const plan = await planAll(invocation, analysis, targets, ledger);

  if (!invocation.dryRun) await executeAll(invocation, analysis, targets, ledger, plan);
  renderPlan(invocation, plan, context.log);

  return 0;
}

/** One row of a `doctor --targets` drift report. */
export type TargetStatusRow = {
  key: string;
  item: LedgerItem;
  status: TargetStatus;
};

/** Compare every ledger item at one scope against disk. */
export async function targetStatuses(
  scope: Invocation['scope'],
  context: RunContext,
): Promise<TargetStatusRow[]> {
  const targets = resolveTargets(scope, context.homeDirectory, context.cwd);
  const ledger = await contextLedger(context, targets);

  const rows: TargetStatusRow[] = [];
  for (const [key, item] of Object.entries(ledger.items)) {
    if (item.scope !== scope) continue;

    rows.push({ key, item, status: await itemStatus(key, item) });
  }

  return rows;
}

/** Run `skillset doctor --targets`: check every managed output for drift. */
export async function runDoctorTargets(
  invocation: Invocation,
  context: RunContext,
): Promise<number> {
  const rows = await targetStatuses(invocation.scope, context);

  if (invocation.json) {
    context.log(
      JSON.stringify(
        rows.map(({ key, item, status }) => ({ ...item, path: key, status })),
        undefined,
        2,
      ),
    );
  } else {
    for (const { key, item, status } of rows) {
      const label = {
        clean: chalk.green('clean'),
        drift: chalk.yellow('drift'),
        missing: chalk.red('missing'),
      }[status];
      context.log(`${label} ${item.target} ${item.kind} ${item.name}: ${key}`);
    }
    if (rows.length === 0) context.log('nothing managed yet — run `skillset sync` first');
  }

  return rows.some((row) => row.status !== 'clean') ? 1 : 0;
}

/** Run `skillset import`: reverse-compile, then adopt via a forced sync. */
export async function runImport(invocation: Invocation, context: RunContext): Promise<number> {
  const targets = contextTargets(invocation, context);
  const root = resolveSourceRoot(context.skillsetDirectory, context.cwd);

  const sourcePath = await importSource(
    {
      kind: invocation.importKind!,
      ...(invocation.name === undefined ? {} : { name: invocation.name }),
      from: invocation.from ?? 'claude',
    },
    root,
    targets,
  );
  context.log(`imported ${sourcePath}`);

  const analysis = await analyzeSources(context.skillsetDirectory, context.cwd);
  if (analysisHasErrors(analysis)) {
    context.log(
      chalk.yellow(
        'imported source has doctor errors — fix them and run `skillset sync --force` to adopt',
      ),
    );

    return 1;
  }

  const ledger = await contextLedger(context, targets);
  const kindFilter: KindFilter =
    invocation.importKind === 'skill'
      ? 'skills'
      : invocation.importKind === 'agent'
        ? 'agents'
        : 'instructions';
  const adoption: Invocation = { ...invocation, kind: kindFilter, force: true, prune: false };

  const plan = await planAll(adoption, analysis, targets, ledger);
  const wanted = invocation.importKind === 'instructions' ? 'instructions' : invocation.name!;
  plan.actions = plan.actions.filter((action) => action.name === wanted);
  plan.embedded = [];

  await executeAll(adoption, analysis, targets, ledger, plan);
  for (const action of plan.actions) context.log(renderSyncAction(action));
  context.log('adopted — targets are now managed by skillset');

  return 0;
}
