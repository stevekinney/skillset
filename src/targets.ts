import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

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
};

function overrideDirectory(
  value: string | undefined,
  workingDirectory: string,
): string | undefined {
  return value ? resolve(workingDirectory, value) : undefined;
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
  const codexHome =
    overrideDirectory(overrides.codexHome, workingDirectory) ?? join(home, '.codex');

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
    ledgerFile: join(homeDirectory, '.config', 'skillset', 'state.json'),
  };
}
