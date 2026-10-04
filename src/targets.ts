import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

import type { Target } from './frontmatter.js';

/** Where compiled output lands: the user's home config or the current repo. */
export type Scope = 'user' | 'project';

/** Every destination path for one tool at one scope. */
export type ToolTargets = {
  /** Directory of per-skill subdirectories. */
  skills: string;
  /** Directory of per-agent files (.md for Claude, .toml for Codex). */
  agents: string;
  /** Config file holding MCP server entries. */
  mcpConfig: string;
  /** The compiled instructions file (CLAUDE.md / AGENTS.md). */
  instructions: string;
  /** Config file holding lifecycle hooks. */
  hooksConfig: string;
  /** Config file holding model/effort defaults. */
  defaultsConfig: string;
};

/** The full destination map for one scope, plus the ledger location. */
export type Targets = {
  scope: Scope;
  claude: ToolTargets;
  codex: ToolTargets;
  /** The sync ledger (always user-level, shared across scopes). */
  ledgerFile: string;
  /**
   * Where the ledger lived before it followed `XDG_CONFIG_HOME`/`%APPDATA%`:
   * `~/.config/skillset/state.json`. Read until the new ledger exists, and
   * removed once it is written. Equal to `ledgerFile` when nothing moved.
   */
  legacyLedgerFile: string;
};

/**
 * The tools' own variables for moving their user-level configuration:
 * `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. Empty values count as unset.
 */
export type ConfigDirectoryOverrides = {
  /** `CLAUDE_CONFIG_DIR`: replaces `~/.claude`, and holds `.claude.json` instead of the home directory. */
  claudeConfigDirectory?: string | undefined;
  /** `CODEX_HOME`: replaces `~/.codex`. User skills stay in `~/.agents/skills`. */
  codexHome?: string | undefined;
  /** `XDG_CONFIG_HOME`: where the ledger lives (`<it>/skillset`), when absolute. */
  xdgConfigHome?: string | undefined;
  /** `APPDATA`: where the ledger lives on Windows (`<it>\\skillset`). */
  appData?: string | undefined;
  /** The OS to resolve for; defaults to the running one. */
  platform?: string | undefined;
};

/**
 * The ledger's directory: `$XDG_CONFIG_HOME/skillset` when that is set to an
 * absolute path (the XDG rule; a relative value is ignored), `%APPDATA%\\skillset`
 * on Windows, otherwise `~/.config/skillset`.
 */
function ledgerDirectory(home: string, overrides: ConfigDirectoryOverrides): string {
  if (overrides.xdgConfigHome && isAbsolute(overrides.xdgConfigHome)) {
    return join(overrides.xdgConfigHome, 'skillset');
  }
  if ((overrides.platform ?? process.platform) === 'win32' && overrides.appData) {
    return join(overrides.appData, 'skillset');
  }
  return join(home, '.config', 'skillset');
}

function overrideDirectory(
  value: string | undefined,
  workingDirectory: string,
): string | undefined {
  return value ? resolve(workingDirectory, value) : undefined;
}

/**
 * Resolve `path` through the file system one component at a time, so a `..`
 * applies to the real (symlink-resolved) directory before it, as the OS
 * `realpath` does. Runtimes differ on whether `realpathSync.native` normalizes
 * `..` lexically first, so it isn't relied on for that.
 */
function physicalPath(path: string, value: string): string {
  const { root } = parse(path);
  let current = root;
  for (const segment of path.slice(root.length).split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      current = dirname(current);
      continue;
    }
    const next = join(current, segment);
    if (!statSync(next, { throwIfNoEntry: false })) {
      throw new Error(`CODEX_HOME points to \`${value}\`, which does not exist`);
    }
    current = realpathSync(next);
  }

  return current;
}

/**
 * `CODEX_HOME` as Codex resolves it: an explicitly set home must already exist
 * as a directory, and it is canonicalized through the file system, so a
 * symlink followed by `..` lands where Codex looks, not where a lexical
 * `resolve` would.
 */
function canonicalCodexHome(value: string, workingDirectory: string): string {
  const path = isAbsolute(value) ? value : `${workingDirectory}${sep}${value}`;
  const canonical = physicalPath(path, value);
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`CODEX_HOME points to \`${value}\`, which is not a directory`);
  }

  return canonical;
}

function userTargets(
  home: string,
  overrides: ConfigDirectoryOverrides,
  workingDirectory: string,
): Record<Target, ToolTargets> {
  // Claude Code refuses a relative CLAUDE_CONFIG_DIR ("is not an absolute path"),
  // so resolving it here would write files Claude never reads. CODEX_HOME is
  // resolved like Codex resolves it.
  if (overrides.claudeConfigDirectory && !isAbsolute(overrides.claudeConfigDirectory)) {
    throw new Error(
      `CLAUDE_CONFIG_DIR must be an absolute path (got \`${overrides.claudeConfigDirectory}\`); Claude Code rejects a relative one`,
    );
  }
  const claudeOverride = overrideDirectory(overrides.claudeConfigDirectory, workingDirectory);
  const claudeHome = claudeOverride ?? join(home, '.claude');
  const codexHome = overrides.codexHome
    ? canonicalCodexHome(overrides.codexHome, workingDirectory)
    : join(home, '.codex');

  return {
    claude: {
      skills: join(claudeHome, 'skills'),
      agents: join(claudeHome, 'agents'),
      mcpConfig: join(claudeOverride ?? home, '.claude.json'),
      instructions: join(claudeHome, 'CLAUDE.md'),
      hooksConfig: join(claudeHome, 'settings.json'),
      defaultsConfig: join(claudeHome, 'settings.json'),
    },
    codex: {
      skills: join(home, '.agents', 'skills'),
      agents: join(codexHome, 'agents'),
      mcpConfig: join(codexHome, 'config.toml'),
      instructions: join(codexHome, 'AGENTS.md'),
      hooksConfig: join(codexHome, 'hooks.json'),
      defaultsConfig: join(codexHome, 'config.toml'),
    },
  };
}

function projectTargets(root: string): Record<Target, ToolTargets> {
  return {
    claude: {
      skills: join(root, '.claude', 'skills'),
      agents: join(root, '.claude', 'agents'),
      mcpConfig: join(root, '.mcp.json'),
      instructions: join(root, 'CLAUDE.md'),
      hooksConfig: join(root, '.claude', 'settings.json'),
      defaultsConfig: join(root, '.claude', 'settings.json'),
    },
    codex: {
      skills: join(root, '.agents', 'skills'),
      agents: join(root, '.codex', 'agents'),
      mcpConfig: join(root, '.codex', 'config.toml'),
      instructions: join(root, 'AGENTS.md'),
      hooksConfig: join(root, '.codex', 'hooks.json'),
      defaultsConfig: join(root, '.codex', 'config.toml'),
    },
  };
}

/**
 * Resolve every destination path for a scope. User scope writes into the
 * home directory; project scope writes into the working directory's repo
 * layout. At user scope, `overrides` carries the tools' own `CLAUDE_CONFIG_DIR`
 * and `CODEX_HOME`. The ledger always lives under the user's XDG config dir.
 */
export function resolveTargets(
  scope: Scope,
  homeDirectory: string = homedir(),
  workingDirectory: string = process.cwd(),
  overrides: ConfigDirectoryOverrides = {},
): Targets {
  const tools =
    scope === 'user'
      ? userTargets(homeDirectory, overrides, workingDirectory)
      : projectTargets(workingDirectory);

  return {
    scope,
    ...tools,
    ledgerFile: join(ledgerDirectory(homeDirectory, overrides), 'state.json'),
    legacyLedgerFile: join(homeDirectory, '.config', 'skillset', 'state.json'),
  };
}
