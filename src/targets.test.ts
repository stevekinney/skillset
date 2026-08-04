import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
