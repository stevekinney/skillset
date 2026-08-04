import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { emitClaudeAgent, emitCodexAgent, GENERATED_MARKER_TOML } from './agent-emit.js';
import type { ParsedAgentFile } from './agent-frontmatter.js';
import type { SourceAgent, SourceSkill } from './discover.js';
import { emitSkill, GENERATED_MARKER, type EmittedFile } from './emit.js';
import { isMapping, type ParsedSkillFile, type Target } from './frontmatter.js';
import { emitInstructions } from './instructions.js';
import { fileKey, forgetItem, hashContent, recordItem, type Ledger } from './ledger.js';
import type { Scope, Targets } from './targets.js';

/** What the sync intends to do (or did) to one target path. */
export type SyncAction = {
  target: Target;
  kind: 'skill' | 'agent' | 'instructions';
  name: string;
  /** Absolute path of the target (skill directory or file). */
  path: string;
  action: 'write' | 'overwrite' | 'skip-unmanaged' | 'skip-drifted' | 'prune';
};

/** Options accepted by {@link planSync}. */
export type SyncOptions = {
  targets: Target[];
  /** Which file-based source kinds to plan; pruning is scoped to the same kinds. */
  kinds: ('skill' | 'agent' | 'instructions')[];
  prune: boolean;
  /** Overwrite unmanaged or drifted targets. */
  force: boolean;
};

/** A source skill that passed doctor and is ready to compile. */
export type CompilableSkill = {
  source: SourceSkill;
  parsed: ParsedSkillFile;
};

/** A source agent that passed doctor and is ready to compile. */
export type CompilableAgent = {
  source: SourceAgent;
  parsed: ParsedAgentFile;
};

/** The doctor-approved file-based inputs to a sync. */
export type CompilableSources = {
  skills: CompilableSkill[];
  agents: CompilableAgent[];
  /** Raw instructions.md contents, when present. */
  instructions?: string;
};

function isMarked(contents: string | undefined): boolean {
  if (contents === undefined) return false;

  return contents.includes(GENERATED_MARKER) || contents.includes(GENERATED_MARKER_TOML);
}

/** The primary file whose marker decides whether a target is managed. */
function primaryFile(kind: SyncAction['kind'], path: string): string {
  return kind === 'skill' ? join(path, 'SKILL.md') : path;
}

async function isManaged(kind: SyncAction['kind'], path: string): Promise<boolean> {
  return isMarked(await readFile(primaryFile(kind, path), 'utf8').catch(() => undefined));
}

/** The per-file hash record stored in ledger entries for file kinds. */
type FileHashes = Record<string, string>;

function ledgerFiles(entry: unknown): FileHashes {
  if (!isMapping(entry)) return {};
  const files = entry['files'];
  if (!isMapping(files)) return {};

  const hashes: FileHashes = {};
  for (const [relativePath, value] of Object.entries(files)) {
    if (typeof value === 'string') hashes[relativePath] = value;
  }

  return hashes;
}

/**
 * True when any file recorded in the ledger for this target differs from
 * disk. Targets with no recorded hashes (pre-ledger outputs) never drift.
 */
export async function hasDrifted(path: string, entry: unknown): Promise<boolean> {
  for (const [relativePath, hash] of Object.entries(ledgerFiles(entry))) {
    const filePath = relativePath === '' ? path : join(path, relativePath);
    const contents = await readFile(filePath, 'utf8').catch(() => undefined);

    if (contents === undefined || hashContent(contents) !== hash) return true;
  }

  return false;
}

async function resolveAction(
  kind: SyncAction['kind'],
  path: string,
  exists: boolean,
  ledger: Ledger,
  force: boolean,
): Promise<SyncAction['action']> {
  if (!exists) return 'write';
  if (force) return 'overwrite';
  if (!(await isManaged(kind, path))) return 'skip-unmanaged';

  const item = ledger.items[fileKey(path)];
  if (item && (await hasDrifted(path, item.entry))) return 'skip-drifted';

  return 'overwrite';
}

async function listDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function listAgentFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && /\.(md|toml)$/.test(entry.name))
    .map((entry) => entry.name);
}

/** The filename an agent compiles to for a target. */
export function agentFileName(name: string, target: Target): string {
  return target === 'claude' ? `${name}.md` : `${name}.toml`;
}

async function fileExists(path: string): Promise<boolean> {
  return (await readFile(path, 'utf8').catch(() => undefined)) !== undefined;
}

async function planSkillActions(
  sources: CompilableSources,
  skillsRoot: string,
  target: Target,
  ledger: Ledger,
  options: SyncOptions,
): Promise<SyncAction[]> {
  const actions: SyncAction[] = [];
  const directories = await listDirectories(skillsRoot);

  for (const skill of sources.skills) {
    const path = join(skillsRoot, skill.source.name);
    actions.push({
      target,
      kind: 'skill',
      name: skill.source.name,
      path,
      action: await resolveAction(
        'skill',
        path,
        directories.includes(skill.source.name),
        ledger,
        options.force,
      ),
    });
  }

  if (!options.prune) return actions;

  const names = new Set(sources.skills.map((skill) => skill.source.name));
  for (const name of directories) {
    const path = join(skillsRoot, name);

    if (!names.has(name) && (await isManaged('skill', path))) {
      actions.push({ target, kind: 'skill', name, path, action: 'prune' });
    }
  }

  return actions;
}

async function planAgentActions(
  sources: CompilableSources,
  agentsRoot: string,
  target: Target,
  ledger: Ledger,
  options: SyncOptions,
): Promise<SyncAction[]> {
  const actions: SyncAction[] = [];
  const files = await listAgentFiles(agentsRoot);

  for (const agent of sources.agents) {
    const fileName = agentFileName(agent.source.name, target);
    const path = join(agentsRoot, fileName);
    actions.push({
      target,
      kind: 'agent',
      name: agent.source.name,
      path,
      action: await resolveAction('agent', path, files.includes(fileName), ledger, options.force),
    });
  }

  if (!options.prune) return actions;

  const names = new Set(sources.agents.map((agent) => agentFileName(agent.source.name, target)));
  for (const fileName of files) {
    const path = join(agentsRoot, fileName);

    if (!names.has(fileName) && (await isManaged('agent', path))) {
      actions.push({
        target,
        kind: 'agent',
        name: basename(fileName).replace(/\.(md|toml)$/, ''),
        path,
        action: 'prune',
      });
    }
  }

  return actions;
}

async function planInstructionsActions(
  sources: CompilableSources,
  path: string,
  target: Target,
  ledger: Ledger,
  options: SyncOptions,
): Promise<SyncAction[]> {
  const present = await fileExists(path);

  if (sources.instructions === undefined) {
    if (options.prune && present && (await isManaged('instructions', path))) {
      return [{ target, kind: 'instructions', name: 'instructions', path, action: 'prune' }];
    }

    return [];
  }

  return [
    {
      target,
      kind: 'instructions',
      name: 'instructions',
      path,
      action: await resolveAction('instructions', path, present, ledger, options.force),
    },
  ];
}

/**
 * Compute the full action list for the file-based kinds without touching
 * disk: write new targets, overwrite previously generated ones, skip
 * hand-installed (unmanaged) and hand-edited (drifted) ones unless forced,
 * and — with `prune` — remove generated targets that left the source.
 */
export async function planSync(
  sources: CompilableSources,
  targets: Targets,
  ledger: Ledger,
  options: SyncOptions,
): Promise<SyncAction[]> {
  const actions: SyncAction[] = [];

  for (const target of options.targets) {
    const paths = targets[target];

    if (options.kinds.includes('skill')) {
      actions.push(...(await planSkillActions(sources, paths.skills, target, ledger, options)));
    }
    if (options.kinds.includes('agent')) {
      actions.push(...(await planAgentActions(sources, paths.agents, target, ledger, options)));
    }
    if (options.kinds.includes('instructions')) {
      actions.push(
        ...(await planInstructionsActions(sources, paths.instructions, target, ledger, options)),
      );
    }
  }

  return actions;
}

async function writeEmittedFiles(directory: string, files: EmittedFile[]): Promise<FileHashes> {
  const hashes: FileHashes = {};

  for (const file of files) {
    const path = join(directory, file.relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.contents, 'utf8');
    hashes[file.relativePath] = hashContent(file.contents);
  }

  return hashes;
}

async function copySupportingFiles(skill: CompilableSkill, directory: string): Promise<void> {
  for (const relativePath of skill.source.supportingFiles) {
    const destination = join(directory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(skill.source.directory, relativePath), destination);
  }
}

async function writeSingleFile(path: string, contents: string): Promise<FileHashes> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');

  return { '': hashContent(contents) };
}

async function executeWrite(action: SyncAction, sources: CompilableSources): Promise<FileHashes> {
  if (action.kind === 'skill') {
    const skill = sources.skills.find((candidate) => candidate.source.name === action.name)!;
    await mkdir(action.path, { recursive: true });
    const hashes = await writeEmittedFiles(action.path, emitSkill(skill.parsed, action.target));
    await copySupportingFiles(skill, action.path);

    return hashes;
  }

  if (action.kind === 'agent') {
    const agent = sources.agents.find((candidate) => candidate.source.name === action.name)!;
    const contents =
      action.target === 'claude' ? emitClaudeAgent(agent.parsed) : emitCodexAgent(agent.parsed);

    return writeSingleFile(action.path, contents);
  }

  return writeSingleFile(action.path, emitInstructions(sources.instructions!, action.target));
}

/**
 * Execute a previously computed plan. Write and overwrite actions replace the
 * target wholesale and record ledger entries; prune actions remove both;
 * skips touch nothing.
 */
export async function executeSync(
  sources: CompilableSources,
  actions: SyncAction[],
  ledger: Ledger,
  scope: Scope,
): Promise<void> {
  for (const action of actions) {
    if (action.action === 'skip-unmanaged' || action.action === 'skip-drifted') continue;

    await rm(action.path, { recursive: true, force: true });
    if (action.action === 'prune') {
      forgetItem(ledger, fileKey(action.path));
      continue;
    }

    const files = await executeWrite(action, sources);
    recordItem(ledger, fileKey(action.path), {
      kind: action.kind,
      name: action.name,
      scope,
      target: action.target,
      hash: hashContent(JSON.stringify(files)),
      entry: { files },
    });
  }
}
