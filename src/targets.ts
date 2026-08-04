import { homedir } from 'node:os';
import { join } from 'node:path';

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

function userTargets(home: string): Record<Target, ToolTargets> {
  return {
    claude: {
      skills: join(home, '.claude', 'skills'),
      agents: join(home, '.claude', 'agents'),
      mcpConfig: join(home, '.claude.json'),
      instructions: join(home, '.claude', 'CLAUDE.md'),
      hooksConfig: join(home, '.claude', 'settings.json'),
      defaultsConfig: join(home, '.claude', 'settings.json'),
    },
    codex: {
      skills: join(home, '.agents', 'skills'),
      agents: join(home, '.codex', 'agents'),
      mcpConfig: join(home, '.codex', 'config.toml'),
      instructions: join(home, '.codex', 'AGENTS.md'),
      hooksConfig: join(home, '.codex', 'hooks.json'),
      defaultsConfig: join(home, '.codex', 'config.toml'),
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
 * layout. The ledger always lives under the user's XDG config dir.
 */
export function resolveTargets(
  scope: Scope,
  homeDirectory: string = homedir(),
  workingDirectory: string = process.cwd(),
): Targets {
  const tools = scope === 'user' ? userTargets(homeDirectory) : projectTargets(workingDirectory);

  return {
    scope,
    ...tools,
    ledgerFile: join(homeDirectory, '.config', 'skillset', 'state.json'),
  };
}
