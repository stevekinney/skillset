import {
  backupOnce,
  readJsonConfig,
  writeJsonConfig,
  type EmbeddedAction,
} from './config-files.js';
import { isMapping, type Target } from './frontmatter.js';
import {
  CODEX_HOOK_EVENTS,
  hookEntry,
  hookName,
  hookTargets,
  type HooksSource,
} from './hooks-config.js';
import {
  embeddedKey,
  forgetItem,
  hashContent,
  recordItem,
  stableStringify,
  structurallyEqual,
  type Ledger,
} from './ledger.js';
import type { Scope } from './targets.js';

/** The two config files hook sync edits for one scope. */
export type HookConfigFiles = Record<Target, string>;

/** Options for {@link planHooksApply}. */
export type HooksApplyOptions = {
  targets: Target[];
  scope: Scope;
  prune: boolean;
  force: boolean;
};

type PlannedHook = {
  event: string;
  name: string;
  entry: Record<string, unknown>;
};

/** Every hook the source wants for one target, with its stable ledger name. */
export function plannedHooks(source: HooksSource, target: Target): PlannedHook[] {
  const planned: PlannedHook[] = [];

  for (const [event, definitions] of Object.entries(source.hooks)) {
    for (const [index, definition] of definitions.entries()) {
      if (!hookTargets(definition).includes(target)) continue;
      if (target === 'codex' && !CODEX_HOOK_EVENTS.has(event)) continue;

      planned.push({
        event,
        name: hookName(event, definition, index),
        entry: hookEntry(definition, target),
      });
    }
  }

  return planned;
}

function hooksContainer(config: Record<string, unknown>): Record<string, unknown> {
  const container = config['hooks'];

  return isMapping(container) ? container : {};
}

function eventEntries(container: Record<string, unknown>, event: string): unknown[] {
  const entries = container[event];

  return Array.isArray(entries) ? entries : [];
}

function findEntry(entries: unknown[], entry: unknown): number {
  return entries.findIndex((candidate) => structurallyEqual(candidate, entry));
}

/**
 * Compute the hooks action list. Both tools nest entries under a `hooks` key
 * ({Event: [entry, …]}); ownership is entry-level via the ledger: an entry we
 * previously wrote that no longer appears verbatim in the config has been
 * hand-edited (or removed) and is skipped as drifted unless forced.
 */
function resolveHookAction(
  container: Record<string, unknown>,
  event: string,
  managedEntry: unknown,
  force: boolean,
): EmbeddedAction['action'] {
  if (managedEntry === undefined) return 'write';
  if (findEntry(eventEntries(container, event), managedEntry) !== -1) return 'overwrite';

  return force ? 'overwrite' : 'skip-drifted';
}

async function planHooksTarget(
  source: HooksSource | undefined,
  target: Target,
  file: string,
  ledger: Ledger,
  options: HooksApplyOptions,
): Promise<EmbeddedAction[]> {
  const container = hooksContainer(await readJsonConfig(file));
  const planned = source ? plannedHooks(source, target) : [];

  const actions: EmbeddedAction[] = planned.map((hook) => ({
    target,
    kind: 'hook',
    name: hook.name,
    file,
    action: resolveHookAction(
      container,
      hook.event,
      ledger.items[embeddedKey(file, 'hook', hook.name)]?.entry,
      options.force,
    ),
  }));

  if (!options.prune) return actions;

  const plannedNames = new Set(planned.map((hook) => hook.name));
  for (const [key, item] of Object.entries(ledger.items)) {
    if (item.kind !== 'hook' || !key.startsWith(`${file}#`)) continue;
    if (plannedNames.has(item.name)) continue;

    actions.push({ target, kind: 'hook', name: item.name, file, action: 'prune' });
  }

  return actions;
}

export async function planHooksApply(
  source: HooksSource | undefined,
  files: HookConfigFiles,
  ledger: Ledger,
  options: HooksApplyOptions,
): Promise<EmbeddedAction[]> {
  const actions: EmbeddedAction[] = [];

  for (const target of options.targets) {
    actions.push(...(await planHooksTarget(source, target, files[target], ledger, options)));
  }

  return actions;
}

function removeManagedEntry(
  container: Record<string, unknown>,
  event: string,
  entry: unknown,
): void {
  const entries = eventEntries(container, event);
  const index = findEntry(entries, entry);
  if (index !== -1) entries.splice(index, 1);

  if (entries.length === 0) {
    delete container[event];
  } else {
    container[event] = entries;
  }
}

function insertEntry(container: Record<string, unknown>, event: string, entry: unknown): void {
  const entries = eventEntries(container, event);
  if (findEntry(entries, entry) === -1) entries.push(entry);
  container[event] = entries;
}

/**
 * Execute a previously computed hooks plan: back up each touched config once,
 * replace managed entries, and update the ledger. Rewriting Codex hook config
 * invalidates its trust hashes — the caller surfaces the re-trust reminder.
 */
export async function executeHooksApply(
  source: HooksSource | undefined,
  actions: EmbeddedAction[],
  files: HookConfigFiles,
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
    await backupOnce(file, backedUp);

    const config = await readJsonConfig(file);
    const container = hooksContainer(config);
    const planned = new Map(
      (source ? plannedHooks(source, target) : []).map((hook) => [hook.name, hook]),
    );

    for (const action of targetActions) {
      const key = embeddedKey(file, 'hook', action.name);
      const managed = ledger.items[key];
      const managedEvent = managed ? action.name.split('/')[0]! : undefined;

      if (managed !== undefined && managedEvent !== undefined) {
        removeManagedEntry(container, managedEvent, managed.entry);
      }
      if (action.action === 'prune') {
        forgetItem(ledger, key);
        continue;
      }

      const hook = planned.get(action.name)!;
      insertEntry(container, hook.event, hook.entry);
      recordItem(ledger, key, {
        kind: 'hook',
        name: hook.name,
        scope,
        target,
        hash: hashContent(stableStringify(hook.entry)),
        entry: hook.entry,
      });
    }

    config['hooks'] = container;
    await writeJsonConfig(file, config);
  }
}
