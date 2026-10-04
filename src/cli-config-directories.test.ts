import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  addAgent,
  addSkill,
  exists,
  makeFixture,
  removeFixtures,
  validAgent,
  validSkill,
} from '../test/cli-fixture.js';
import { runCli } from './cli.js';

afterEach(removeFixtures);

describe('config directory overrides', () => {
  it('syncs into CLAUDE_CONFIG_DIR and CODEX_HOME instead of the defaults', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    await addAgent(fixture, 'reviewer', validAgent);
    const claudeHome = join(fixture.root, 'claude-config');
    const codexHome = join(fixture.root, 'codex-home');
    // Codex requires an explicitly set CODEX_HOME to exist already.
    await mkdir(codexHome);

    const code = await runCli(['sync'], {
      ...fixture.dependencies,
      env: { NODE_ENV: 'test', CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome },
    });

    expect(code).toBe(0);
    expect(await Bun.file(join(claudeHome, 'skills', 'demo', 'SKILL.md')).exists()).toBe(true);
    expect(await Bun.file(join(claudeHome, 'agents', 'reviewer.md')).exists()).toBe(true);
    expect(await Bun.file(join(codexHome, 'agents', 'reviewer.toml')).exists()).toBe(true);
    expect(
      await Bun.file(join(fixture.home, '.agents', 'skills', 'demo', 'SKILL.md')).exists(),
    ).toBe(true);
    expect(await exists(join(fixture.home, '.claude'))).toBe(false);
    expect(await exists(join(fixture.home, '.codex'))).toBe(false);
    expect(await exists(claudeHome)).toBe(true);
  });
});

describe('relative CLAUDE_CONFIG_DIR', () => {
  it('fails with a clear message instead of writing somewhere Claude Code never reads', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const code = await runCli(['sync'], {
      ...fixture.dependencies,
      env: { NODE_ENV: 'test', CLAUDE_CONFIG_DIR: 'relative-config' },
    });
    expect(code).toBe(1);
    expect(fixture.lines.join('\n')).toContain('CLAUDE_CONFIG_DIR must be an absolute path');
  });

  it('does not affect project scope, which ignores the overrides', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const code = await runCli(['sync', '--scope', 'project'], {
      ...fixture.dependencies,
      env: { NODE_ENV: 'test', CLAUDE_CONFIG_DIR: 'relative-config' },
    });
    expect(code).toBe(0);
    expect(await exists(join(fixture.root, '.claude', 'skills', 'demo', 'SKILL.md'))).toBe(true);
  });
});

describe('ledger migration to XDG_CONFIG_HOME', () => {
  it('reads the old ledger until a sync writes the new one, then retires the old one', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const legacy = join(fixture.home, '.config', 'skillset', 'state.json');
    const xdg = join(fixture.root, 'xdg');
    const moved = join(xdg, 'skillset', 'state.json');
    const withXdg = {
      ...fixture.dependencies,
      env: { NODE_ENV: 'test', XDG_CONFIG_HOME: xdg },
    };

    expect(await runCli(['sync'], fixture.dependencies)).toBe(0);
    expect(await exists(legacy)).toBe(true);

    // A read-only command finds the old ledger and moves nothing.
    expect(await runCli(['doctor', '--targets'], withXdg)).toBe(0);
    expect(fixture.lines.join('\n')).not.toContain('missing');
    expect(await exists(legacy)).toBe(true);
    expect(await exists(moved)).toBe(false);

    // The next sync writes the ledger at its new home and removes the old file.
    expect(await runCli(['sync'], withXdg)).toBe(0);
    expect(await exists(moved)).toBe(true);
    expect(await exists(legacy)).toBe(false);
    const ledger = JSON.parse(await Bun.file(moved).text());
    expect(JSON.stringify(ledger.items)).toContain('"name":"demo"');
  });
});

describe('a ledger skillset cannot read', () => {
  it('stops sync before it writes anything, and leaves the ledger as it was', async () => {
    const fixture = await makeFixture();
    await addSkill(fixture, 'demo', validSkill);
    const ledger = join(fixture.home, '.config', 'skillset', 'state.json');
    await mkdir(join(ledger, '..'), { recursive: true });
    await Bun.write(ledger, '{"version": 2, "items": {');

    expect(await runCli(['sync'], fixture.dependencies)).not.toBe(0);
    expect(fixture.lines.join('\n')).toContain(ledger);
    expect(await Bun.file(ledger).text()).toBe('{"version": 2, "items": {');
    expect(await exists(join(fixture.home, '.claude', 'skills', 'demo'))).toBe(false);
  });

  it('stops import before it writes the source, so the import can be retried', async () => {
    const fixture = await makeFixture();
    const installed = join(fixture.home, '.claude', 'skills', 'legacy');
    await mkdir(installed, { recursive: true });
    await Bun.write(
      join(installed, 'SKILL.md'),
      '---\nname: legacy\ndescription: Hand installed.\n---\n\nBody.\n',
    );
    const ledger = join(fixture.home, '.config', 'skillset', 'state.json');
    await mkdir(join(ledger, '..'), { recursive: true });
    await Bun.write(ledger, 'not json');

    expect(await runCli(['import', 'skill', 'legacy'], fixture.dependencies)).not.toBe(0);
    expect(await exists(join(fixture.root, 'skills', 'legacy'))).toBe(false);
  });
});
