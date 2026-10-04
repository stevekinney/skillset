import type { Dirent } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

/** A skill directory found in the source tree, with its raw SKILL.md. */
export type SourceSkill = {
  /** The directory name, which the spec requires to equal the `name` field. */
  name: string;
  /** Absolute path to the skill directory. */
  directory: string;
  /** Raw contents of SKILL.md. */
  raw: string;
  /** Paths of every other file in the directory, relative to it. */
  supportingFiles: string[];
};

/** An agent markdown file found in the source tree. */
export type SourceAgent = {
  /** The filename stem, which must equal the `name` field. */
  name: string;
  /** Absolute path to the .md file. */
  path: string;
  /** Raw file contents. */
  raw: string;
};

/** A single-file source at the root (mcp-servers.yaml, instructions.md, …). */
export type SourceFile = {
  /** Absolute path to the file. */
  path: string;
  /** Raw file contents. */
  raw: string;
};

/** Everything found under the source root. */
export type Sources = {
  root: string;
  skills: SourceSkill[];
  agents: SourceAgent[];
  mcp?: SourceFile;
  instructions?: SourceFile;
  hooks?: SourceFile;
  defaults?: SourceFile;
};

/** The filename of the MCP source at the root. */
export const MCP_SOURCE_FILENAME = 'mcp-servers.yaml';

/** The filename of the instructions source at the root. */
export const INSTRUCTIONS_SOURCE_FILENAME = 'instructions.md';

/** The filename of the hooks source at the root. */
export const HOOKS_SOURCE_FILENAME = 'hooks.yaml';

/** The filename of the defaults source at the root. */
export const DEFAULTS_SOURCE_FILENAME = 'defaults.yaml';

/**
 * Resolve the source root: `SKILLSET_DIRECTORY` when set, otherwise the
 * working directory. The root is expected to contain `skills/`, `agents/`,
 * and/or `mcp-servers.yaml`.
 */
export function resolveSourceRoot(
  skillsetDirectory: string | undefined,
  workingDirectory: string,
): string {
  return skillsetDirectory ?? workingDirectory;
}

/**
 * What a directory entry really is, following a symlink to its target. A
 * symlinked skill directory, agent file, or supporting folder is a common way to
 * share sources; a broken link is nothing.
 */
async function entryKind(
  directory: string,
  entry: Dirent,
): Promise<'file' | 'directory' | undefined> {
  if (!entry.isSymbolicLink()) {
    if (entry.isDirectory()) return 'directory';
    return entry.isFile() ? 'file' : undefined;
  }
  const target = await stat(join(directory, entry.name)).catch((cause: unknown) => {
    // Only a missing target means a broken link; any other failure (a
    // permission error, say) would otherwise silently drop the source.
    if (isMissing(cause)) return undefined;
    throw cause;
  });
  if (target?.isDirectory()) return 'directory';

  return target?.isFile() ? 'file' : undefined;
}

function isMissing(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;

  return cause.code === 'ENOENT' || cause.code === 'ENOTDIR';
}

async function collectFiles(
  root: string,
  current: string,
  files: string[],
  ancestors: Set<string> = new Set(),
): Promise<void> {
  // Only the directories on the current path: a link back to one of them is a
  // cycle, while two links to the same directory elsewhere are both walked.
  const real = await realpath(current);
  if (ancestors.has(real)) return;
  ancestors.add(real);

  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(current, entry.name);
    const kind = await entryKind(current, entry);

    if (kind === 'directory') {
      await collectFiles(root, path, files, ancestors);
    } else if (kind === 'file') {
      files.push(relative(root, path));
    }
  }

  ancestors.delete(real);
}

async function isDirectory(path: string): Promise<boolean> {
  const stats = await stat(path).catch(() => undefined);

  return stats?.isDirectory() ?? false;
}

/**
 * Enumerate the skills in a skills directory: every subdirectory containing a
 * `SKILL.md`. Subdirectories without one are ignored. A missing skills
 * directory yields an empty list.
 */
export async function discoverSkills(skillsDirectory: string): Promise<SourceSkill[]> {
  if (!(await isDirectory(skillsDirectory))) return [];

  const entries = await readdir(skillsDirectory, { withFileTypes: true });
  const skills: SourceSkill[] = [];

  for (const entry of entries) {
    if ((await entryKind(skillsDirectory, entry)) !== 'directory') continue;
    const directory = join(skillsDirectory, entry.name);
    const raw = await readFile(join(directory, 'SKILL.md'), 'utf8').catch(() => undefined);
    if (raw === undefined) continue;

    const supportingFiles: string[] = [];
    await collectFiles(directory, directory, supportingFiles);

    skills.push({
      name: entry.name,
      directory,
      raw,
      supportingFiles: supportingFiles.filter((file) => file !== 'SKILL.md').toSorted(),
    });
  }

  return skills.toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Enumerate the agents in an agents directory: every `*.md` file. A missing
 * agents directory yields an empty list.
 */
export async function discoverAgents(agentsDirectory: string): Promise<SourceAgent[]> {
  if (!(await isDirectory(agentsDirectory))) return [];

  const entries = await readdir(agentsDirectory, { withFileTypes: true });
  const agents: SourceAgent[] = [];

  for (const entry of entries) {
    if (!entry.name.endsWith('.md') || (await entryKind(agentsDirectory, entry)) !== 'file')
      continue;

    const path = join(agentsDirectory, entry.name);
    agents.push({
      name: basename(entry.name, '.md'),
      path,
      raw: await readFile(path, 'utf8'),
    });
  }

  return agents.toSorted((a, b) => a.name.localeCompare(b.name));
}

async function readSourceFile(root: string, filename: string): Promise<SourceFile | undefined> {
  const path = join(root, filename);
  const raw = await readFile(path, 'utf8').catch(() => undefined);

  return raw === undefined ? undefined : { path, raw };
}

/**
 * Discover every source kind under the root: `skills/`, `agents/`,
 * `mcp-servers.yaml`, `instructions.md`, `hooks.yaml`, and `defaults.yaml`.
 * Individual kinds may be absent; it is an error only when none exists.
 */
async function anySourceDirectory(root: string): Promise<boolean> {
  return (await isDirectory(join(root, 'skills'))) || (await isDirectory(join(root, 'agents')));
}

export async function discoverSources(root: string): Promise<Sources> {
  const sources: Sources = {
    root,
    skills: await discoverSkills(join(root, 'skills')),
    agents: await discoverAgents(join(root, 'agents')),
  };

  const files = [
    ['mcp', MCP_SOURCE_FILENAME],
    ['instructions', INSTRUCTIONS_SOURCE_FILENAME],
    ['hooks', HOOKS_SOURCE_FILENAME],
    ['defaults', DEFAULTS_SOURCE_FILENAME],
  ] as const;
  let anyFile = false;
  for (const [key, filename] of files) {
    const file = await readSourceFile(root, filename);
    if (file) {
      sources[key] = file;
      anyFile = true;
    }
  }

  if (!anyFile && !(await anySourceDirectory(root))) {
    throw new Error(
      `no sources found in ${root} — expected a skills/ or agents/ directory, ${MCP_SOURCE_FILENAME}, ${INSTRUCTIONS_SOURCE_FILENAME}, ${HOOKS_SOURCE_FILENAME}, or ${DEFAULTS_SOURCE_FILENAME}`,
    );
  }

  return sources;
}
