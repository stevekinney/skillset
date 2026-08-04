import { describe, expect, it } from 'bun:test';

import { spliceTomlScalar, spliceTomlSection } from './toml-splice.js';

const config = `# My Codex config — precious comments.
model = "gpt-5.6"

[mcp_servers.github]
command = "gh-mcp"

[mcp_servers.github.tools.issue_write]
approval_mode = "approve"

[agents]
max_threads = 4

[mcp_servers.svelte]
url = "https://mcp.svelte.dev/mcp"
`;

describe('spliceTomlSection', () => {
  it('replaces a section and its subsections, leaving everything else byte-identical', () => {
    const result = spliceTomlSection(
      config,
      'mcp_servers.github',
      '[mcp_servers.github]\nurl = "https://new"',
    );

    expect(result).toContain('# My Codex config — precious comments.');
    expect(result).toContain('model = "gpt-5.6"');
    expect(result).toContain('[agents]\nmax_threads = 4');
    expect(result).toContain('[mcp_servers.svelte]\nurl = "https://mcp.svelte.dev/mcp"');
    expect(result).toContain('url = "https://new"');
    expect(result).not.toContain('command = "gh-mcp"');
    expect(result).not.toContain('approval_mode');
  });

  it('deletes a section when the replacement is undefined', () => {
    const result = spliceTomlSection(config, 'mcp_servers.github', undefined);
    expect(result).not.toContain('gh-mcp');
    expect(result).not.toContain('approval_mode');
    expect(result).toContain('[mcp_servers.svelte]');
    expect(result).toContain('[agents]');
  });

  it('appends a new section at the end when it does not exist', () => {
    const result = spliceTomlSection(
      config,
      'mcp_servers.neon',
      '[mcp_servers.neon]\nurl = "https://n"',
    );
    expect(result.trimEnd().endsWith('[mcp_servers.neon]\nurl = "https://n"')).toBe(true);
    expect(result).toContain('gh-mcp');
  });

  it('appends to an empty file without leading blank lines', () => {
    const result = spliceTomlSection('', 'mcp_servers.a', '[mcp_servers.a]\nx = 1');
    expect(result).toBe('[mcp_servers.a]\nx = 1\n');
  });

  it('is a no-op when deleting a section that does not exist', () => {
    expect(spliceTomlSection(config, 'mcp_servers.missing', undefined)).toBe(config);
  });

  it('does not touch sections whose names merely share a prefix', () => {
    const withPrefix = `[mcp_servers.github-enterprise]\ncommand = "other"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n`;
    const result = spliceTomlSection(withPrefix, 'mcp_servers.github', undefined);
    expect(result).toContain('github-enterprise');
    expect(result).toContain('command = "other"');
    expect(result).not.toContain('gh-mcp');
  });

  it('handles quoted header segments', () => {
    const quoted = `[mcp_servers."my server"]\ncommand = "x"\n`;
    const result = spliceTomlSection(quoted, 'mcp_servers.my server', undefined);
    expect(result).not.toContain('command = "x"');
  });

  it('handles multiple disjoint spans of the same section', () => {
    const disjoint = `[mcp_servers.a]\nx = 1\n\n[other]\ny = 2\n\n[mcp_servers.a.tools.t]\napproval_mode = "approve"\n`;
    const result = spliceTomlSection(disjoint, 'mcp_servers.a', '[mcp_servers.a]\nx = 9');
    expect(result).toContain('x = 9');
    expect(result).toContain('[other]\ny = 2');
    expect(result).not.toContain('approval_mode');
    expect(result).not.toContain('x = 1');
  });
});

describe('spliceTomlScalar', () => {
  const scalarConfig = `# top comment
model = "old"
approval_policy = "on-request"

[agents]
model = "nested"
`;

  it('replaces an existing top-level scalar without touching tables', () => {
    const result = spliceTomlScalar(scalarConfig, 'model', '"new"');
    expect(result).toContain('model = "new"');
    expect(result).toContain('# top comment');
    expect(result).toContain('[agents]\nmodel = "nested"');
    expect(result).not.toContain('model = "old"');
  });

  it('inserts a new scalar before the first table header', () => {
    const result = spliceTomlScalar(scalarConfig, 'model_verbosity', '"low"');
    expect(result.indexOf('model_verbosity = "low"')).toBeLessThan(result.indexOf('[agents]'));
    expect(result).toContain('approval_policy = "on-request"');
  });

  it('appends to a file with no tables and to an empty file', () => {
    expect(spliceTomlScalar('a = 1\n', 'b', '2')).toContain('b = 2');
    expect(spliceTomlScalar('', 'a', '"x"')).toContain('a = "x"');
  });

  it('deletes an existing scalar and no-ops on a missing one', () => {
    const removed = spliceTomlScalar(scalarConfig, 'model', undefined);
    expect(removed).not.toContain('model = "old"');
    expect(removed).toContain('model = "nested"');
    expect(spliceTomlScalar(scalarConfig, 'missing', undefined)).toBe(scalarConfig);
  });
});
