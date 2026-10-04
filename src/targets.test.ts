import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveTargets } from './targets.js';

describe('resolveTargets', () => {
  it('resolves user-scope destinations under the home directory', () => {
    const targets = resolveTargets('user', '/home/user', '/repo');
    expect(targets.scope).toBe('user');
    expect(targets.claude).toEqual({
      skills: join('/home/user', '.claude', 'skills'),
      agents: join('/home/user', '.claude', 'agents'),
      mcpConfig: join('/home/user', '.claude.json'),
      instructions: join('/home/user', '.claude', 'CLAUDE.md'),
      hooksConfig: join('/home/user', '.claude', 'settings.json'),
      defaultsConfig: join('/home/user', '.claude', 'settings.json'),
    });
    expect(targets.codex).toEqual({
      skills: join('/home/user', '.agents', 'skills'),
      agents: join('/home/user', '.codex', 'agents'),
      mcpConfig: join('/home/user', '.codex', 'config.toml'),
      instructions: join('/home/user', '.codex', 'AGENTS.md'),
      hooksConfig: join('/home/user', '.codex', 'hooks.json'),
      defaultsConfig: join('/home/user', '.codex', 'config.toml'),
    });
    expect(targets.ledgerFile).toBe(join('/home/user', '.config', 'skillset', 'state.json'));
  });

  it('resolves project-scope destinations under the working directory', () => {
    const targets = resolveTargets('project', '/home/user', '/repo');
    expect(targets.claude.skills).toBe(join('/repo', '.claude', 'skills'));
    expect(targets.claude.mcpConfig).toBe(join('/repo', '.mcp.json'));
    expect(targets.claude.instructions).toBe(join('/repo', 'CLAUDE.md'));
    expect(targets.codex.instructions).toBe(join('/repo', 'AGENTS.md'));
    expect(targets.codex.hooksConfig).toBe(join('/repo', '.codex', 'hooks.json'));
    // The ledger stays user-level even at project scope.
    expect(targets.ledgerFile).toBe(join('/home/user', '.config', 'skillset', 'state.json'));
  });

  it('defaults to the real home directory and cwd', () => {
    const targets = resolveTargets('user');
    expect(targets.claude.skills).toBe(join(homedir(), '.claude', 'skills'));
  });
});

describe('config directory overrides', () => {
  // Overrides resolve against the working directory, which on Windows also adds a
  // drive letter to a root-relative path like `/configuration/claude`.
  const claudeHome = resolve('/repo', '/configuration/claude');
  const codexHome = resolve('/repo', '/configuration/codex');

  it('relocates Claude Code’s config home and .claude.json with CLAUDE_CONFIG_DIR', () => {
    const targets = resolveTargets('user', '/home/user', '/repo', {
      claudeConfigDirectory: '/configuration/claude',
    });
    expect(targets.claude).toEqual({
      skills: join(claudeHome, 'skills'),
      agents: join(claudeHome, 'agents'),
      mcpConfig: join(claudeHome, '.claude.json'),
      instructions: join(claudeHome, 'CLAUDE.md'),
      hooksConfig: join(claudeHome, 'settings.json'),
      defaultsConfig: join(claudeHome, 'settings.json'),
    });
  });

  it('relocates Codex files with CODEX_HOME, but not user skills', () => {
    const targets = resolveTargets('user', '/home/user', '/repo', {
      codexHome: '/configuration/codex',
    });
    expect(targets.codex).toEqual({
      skills: join('/home/user', '.agents', 'skills'),
      agents: join(codexHome, 'agents'),
      mcpConfig: join(codexHome, 'config.toml'),
      instructions: join(codexHome, 'AGENTS.md'),
      hooksConfig: join(codexHome, 'hooks.json'),
      defaultsConfig: join(codexHome, 'config.toml'),
    });
  });

  it('treats empty values as unset and resolves relative ones against the working directory', () => {
    const plain = resolveTargets('user', '/home/user', '/repo');
    expect(
      resolveTargets('user', '/home/user', '/repo', { claudeConfigDirectory: '', codexHome: '' }),
    ).toEqual(plain);
    const relative = resolveTargets('user', '/home/user', '/repo', { codexHome: 'codex-home' });
    expect(relative.codex.agents).toBe(join(resolve('/repo', 'codex-home'), 'agents'));
  });

  it('rejects a relative CLAUDE_CONFIG_DIR, as Claude Code does, at user scope only', () => {
    expect(() =>
      resolveTargets('user', '/home/user', '/repo', { claudeConfigDirectory: 'claude-config' }),
    ).toThrow('CLAUDE_CONFIG_DIR must be an absolute path');
    expect(() =>
      resolveTargets('project', '/home/user', '/repo', { claudeConfigDirectory: 'claude-config' }),
    ).not.toThrow();
  });

  it('leaves project scope and the ledger alone', () => {
    const overrides = { claudeConfigDirectory: '/c', codexHome: '/x' };
    expect(resolveTargets('project', '/home/user', '/repo', overrides)).toEqual(
      resolveTargets('project', '/home/user', '/repo'),
    );
    expect(resolveTargets('user', '/home/user', '/repo', overrides).ledgerFile).toBe(
      resolveTargets('user', '/home/user', '/repo').ledgerFile,
    );
  });
});
