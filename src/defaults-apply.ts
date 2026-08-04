import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import {
  backupOnce,
  readJsonConfig,
  writeJsonConfig,
  type EmbeddedAction,
} from './config-files.js';
import {
  claudeDefaultEntries,
  codexDefaultEntries,
  type DefaultsSource,
} from './defaults-config.js';
import { isMapping, type Target } from './frontmatter.js';
import { embeddedKey, forgetItem, hashContent, recordItem, type Ledger } from './ledger.js';
import { spliceTomlScalar } from './toml-splice.js';
import type { Scope } from './targets.js';

/** The two config files defaults sync edits for one scope. */
export type DefaultsConfigFiles = Record<Target, string>;

/** Options for {@link planDefaultsApply}. */
export type DefaultsApplyOptions = {
  targets: Target[];
  scope: Scope;
  prune: boolean;
  force: boolean;
};

function desiredEntries(
  source: DefaultsSource | undefined,
  target: Target,
): Record<string, string> {
  if (!source) return {};

  return target === 'claude' ? claudeDefaultEntries(source) : codexDefaultEntries(source);
}

async function currentValues(target: Target, file: string): Promise<Record<string, unknown>> {
  if (target === 'claude') return readJsonConfig(file);

  const raw = await readFile(file, 'utf8').catch(() => undefined);
  if (raw === undefined) return {};

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch {
    throw new Error(`${file} is not valid TOML — refusing to edit it`);
  }

  return isMapping(parsed) ? parsed : {};
}

/**
 * Compute the defaults action list. Each managed key is owned individually:
 * a key the user set themselves is skipped (unmanaged), a managed key whose
 * value changed on disk is skipped as drifted, and pruning removes only keys
 * we set that left the source.
 */
function resolveDefaultAction(
  current: unknown,
  managedEntry: unknown,
  force: boolean,
): EmbeddedAction['action'] {
  if (current === undefined) return 'write';
  if (force) return 'overwrite';
  if (managedEntry === undefined) return 'skip-unmanaged';

  return current === managedEntry ? 'overwrite' : 'skip-drifted';
}

async function planDefaultsTarget(
  source: DefaultsSource | undefined,
  target: Target,
  file: string,
  ledger: Ledger,
  options: DefaultsApplyOptions,
): Promise<EmbeddedAction[]> {
  const desired = desiredEntries(source, target);
  const current = await currentValues(target, file);
  const actions: EmbeddedAction[] = Object.keys(desired).map((key) => ({
    target,
    kind: 'default',
    name: key,
    file,
    action: resolveDefaultAction(
      current[key],
      ledger.items[embeddedKey(file, 'default', key)]?.entry,
      options.force,
    ),
  }));

  if (!options.prune) return actions;

  for (const [ledgerKey, item] of Object.entries(ledger.items)) {
    if (item.kind !== 'default' || !ledgerKey.startsWith(`${file}#`)) continue;
    if (desired[item.name] !== undefined) continue;

    actions.push({ target, kind: 'default', name: item.name, file, action: 'prune' });
  }

  return actions;
}

export async function planDefaultsApply(
  source: DefaultsSource | undefined,
  files: DefaultsConfigFiles,
  ledger: Ledger,
  options: DefaultsApplyOptions,
): Promise<EmbeddedAction[]> {
  const actions: EmbeddedAction[] = [];

  for (const target of options.targets) {
    actions.push(...(await planDefaultsTarget(source, target, files[target], ledger, options)));
  }

  return actions;
}

async function applyClaudeDefaults(
  desired: Record<string, string>,
  actions: EmbeddedAction[],
  file: string,
  ledger: Ledger,
): Promise<void> {
  const config = await readJsonConfig(file);

  for (const action of actions) {
    if (action.action === 'prune') {
      const managed = ledger.items[embeddedKey(file, 'default', action.name)];
      if (config[action.name] === managed?.entry) delete config[action.name];
    } else {
      config[action.name] = desired[action.name];
    }
  }

  await writeJsonConfig(file, config);
}

async function applyCodexDefaults(
  desired: Record<string, string>,
  actions: EmbeddedAction[],
  file: string,
): Promise<void> {
  let contents = await readFile(file, 'utf8').catch(() => '');

  for (const action of actions) {
    const value = action.action === 'prune' ? undefined : JSON.stringify(desired[action.name]);
    contents = spliceTomlScalar(contents, action.name, value);
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
}

/**
 * Execute a previously computed defaults plan: back up each touched config
 * once, apply the key edits, and update the ledger.
 */
export async function executeDefaultsApply(
  source: DefaultsSource | undefined,
  actions: EmbeddedAction[],
  files: DefaultsConfigFiles,
  ledger: Ledger,
  scope: Scope,
  backedUp: Set<string>,
): Promise<void> {
  for (const target of ['claude', 'codex'] as const) {
    const targetActions = actions.filter(
      (action) =>
        action.target === target &&
        action.action !== 'skip-unmanaged' &&
        action.action !== 'skip-drifted',
    );
    if (targetActions.length === 0) continue;

    const file = files[target];
    const desired = desiredEntries(source, target);
    await backupOnce(file, backedUp);

    if (target === 'claude') {
      await applyClaudeDefaults(desired, targetActions, file, ledger);
    } else {
      await applyCodexDefaults(desired, targetActions, file);
    }

    for (const action of targetActions) {
      const key = embeddedKey(file, 'default', action.name);

      if (action.action === 'prune') {
        forgetItem(ledger, key);
      } else {
        const value = desired[action.name]!;
        recordItem(ledger, key, {
          kind: 'default',
          name: action.name,
          scope,
          target,
          hash: hashContent(value),
          entry: value,
        });
      }
    }
  }
}
