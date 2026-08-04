import { describe, expect, it } from 'bun:test';

import {
  checkMcpSource,
  claudeMcpEntry,
  codexMcpSection,
  parseMcpSource,
  resolveTransport,
} from './mcp-config.js';

const raw = `servers:
  neon:
    url: https://mcp.neon.tech/mcp
    headers:
      Authorization: 'Bearer \${NEON_KEY}'
      X-Env: '\${SOME_VAR}'
      X-Static: 'plain'
    timeout: 600000
  local:
    command: npx
    args: ['-y', 'some-mcp']
    env:
      LITERAL: value
      FORWARDED: '\${HOME_TOKEN}'
    codex:
      startup_timeout_sec: 120
    claude:
      oauth:
        callbackPort: 8080
`;

describe('parseMcpSource', () => {
  it('parses and validates servers', () => {
    const parsed = parseMcpSource(raw);
    expect(Object.keys(parsed.source.servers)).toEqual(['neon', 'local']);
    expect(parsed.unknownKeys).toEqual([]);
  });

  it('collects unknown server keys', () => {
    const parsed = parseMcpSource('servers:\n  a:\n    command: x\n    mystery: 1\n');
    expect(parsed.unknownKeys).toEqual(['a.mystery']);
  });

  it('rejects non-mapping documents and schema violations', () => {
    expect(() => parseMcpSource('- a\n')).toThrow('YAML mapping');
    expect(() => parseMcpSource('servers:\n  a:\n    transport: sse\n    url: x\n')).toThrow();
  });
});

describe('resolveTransport', () => {
  it('honors explicit transport and infers from url/command', () => {
    expect(resolveTransport({ transport: 'stdio', command: 'x' })).toBe('stdio');
    expect(resolveTransport({ url: 'https://x' })).toBe('http');
    expect(resolveTransport({ command: 'x' })).toBe('stdio');
    expect(resolveTransport({})).toBeUndefined();
  });
});

const messages = (input: string): string[] =>
  checkMcpSource(parseMcpSource(input)).map((issue) => `${issue.severity}: ${issue.message}`);

describe('checkMcpSource', () => {
  it('passes a coherent source', () => {
    expect(checkMcpSource(parseMcpSource(raw))).toEqual([]);
  });

  it('errors on servers with neither url nor command', () => {
    expect(messages('servers:\n  a:\n    timeout: 5\n')[0]).toContain('needs a `url`');
  });

  it('errors on transport/field mismatches', () => {
    expect(messages('servers:\n  a:\n    transport: http\n    command: x\n').join('\n')).toContain(
      'is http but has no `url`',
    );
    expect(messages('servers:\n  a:\n    transport: stdio\n    url: x\n').join('\n')).toContain(
      'is stdio but has no `command`',
    );
    expect(messages('servers:\n  a:\n    url: x\n    command: y\n').join('\n')).toContain(
      'sets both `url` and `command`',
    );
  });

  it('warns on ${VAR:-default} fallback syntax and unknown keys', () => {
    const report = messages(
      'servers:\n  a:\n    command: x\n    env:\n      K: "${FOO:-bar}"\n    extra: 1\n',
    );
    expect(report.join('\n')).toContain('fallback syntax');
    expect(report.join('\n')).toContain('unknown server key `a.extra`');
  });
});

describe('claudeMcpEntry', () => {
  it('builds http entries with headers and timeout', () => {
    const entry = claudeMcpEntry(parseMcpSource(raw).source.servers['neon']!);
    expect(entry).toEqual({
      type: 'http',
      url: 'https://mcp.neon.tech/mcp',
      headers: {
        Authorization: 'Bearer ${NEON_KEY}',
        'X-Env': '${SOME_VAR}',
        'X-Static': 'plain',
      },
      timeout: 600000,
    });
  });

  it('builds stdio entries and merges claude extras', () => {
    const entry = claudeMcpEntry(parseMcpSource(raw).source.servers['local']!);
    expect(entry['type']).toBe('stdio');
    expect(entry['command']).toBe('npx');
    expect(entry['env']).toEqual({ LITERAL: 'value', FORWARDED: '${HOME_TOKEN}' });
    expect(entry['oauth']).toEqual({ callbackPort: 8080 });
  });
});

describe('codexMcpSection', () => {
  it('maps bearer headers, env headers, and static headers', () => {
    const section = codexMcpSection(parseMcpSource(raw).source.servers['neon']!);
    expect(section['url']).toBe('https://mcp.neon.tech/mcp');
    expect(section['bearer_token_env_var']).toBe('NEON_KEY');
    expect(section['env_http_headers']).toEqual({ 'X-Env': 'SOME_VAR' });
    expect(section['http_headers']).toEqual({ 'X-Static': 'plain' });
    expect(section['tool_timeout_sec']).toBe(600);
  });

  it('splits env literals from forwarded variables and lets codex extras win', () => {
    const section = codexMcpSection(parseMcpSource(raw).source.servers['local']!);
    expect(section['command']).toBe('npx');
    expect(section['env']).toEqual({ LITERAL: 'value' });
    expect(section['env_vars']).toEqual(['HOME_TOKEN']);
    expect(section['startup_timeout_sec']).toBe(120);
    expect(section['oauth']).toBeUndefined();
  });
});
