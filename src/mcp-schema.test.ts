import { describe, expect, it } from 'bun:test';

import {
  claudeMcpEntryProblems,
  codexMcpServerSchema,
  unknownClaudeMcpFields,
} from './mcp-schema.js';

function codexMcpProblems(
  section: Record<string, unknown>,
): { path: PropertyKey[]; message: string }[] {
  const result = codexMcpServerSchema.safeParse(section);

  return result.success ? [] : result.error.issues;
}

const messages = (problems: { path: PropertyKey[]; message: string }[]): string[] =>
  problems.map((problem) => `${problem.path.join('.')}: ${problem.message}`);

describe('claudeMcpEntryProblems', () => {
  it('accepts every authorable transport', () => {
    expect(claudeMcpEntryProblems({ command: 'npx' })).toEqual([]);
    expect(
      claudeMcpEntryProblems({ type: 'stdio', command: 'npx', args: ['a'], env: { A: 'b' } }),
    ).toEqual([]);
    expect(
      claudeMcpEntryProblems({
        type: 'http',
        url: 'https://x',
        headers: { A: 'b' },
        headersHelper: 'echo {}',
        oauth: { clientId: 'id', callbackPort: 8080, scopes: 'a b', xaa: true },
        timeout: 5000,
        tools: [{ name: 'a', permission_policy: 'always_allow' }],
        toolPermissions: { a: 'allow' },
        alwaysLoad: true,
        discoveryCache: false,
      }),
    ).toEqual([]);
    expect(claudeMcpEntryProblems({ type: 'streamable-http', url: 'https://x' })).toEqual([]);
    expect(claudeMcpEntryProblems({ type: 'sse', url: 'https://x' })).toEqual([]);
    expect(claudeMcpEntryProblems({ type: 'ws', url: 'wss://x', headers: {} })).toEqual([]);
  });

  it('reports wrong types and values', () => {
    expect(
      messages(claudeMcpEntryProblems({ type: 'http', url: 'https://x', timeout: '5' }))[0],
    ).toStartWith('timeout:');
    expect(
      messages(claudeMcpEntryProblems({ type: 'http', url: 'https://x', timeout: 1.5 }))[0],
    ).toStartWith('timeout:');
    expect(messages(claudeMcpEntryProblems({ command: '' }))[0]).toStartWith('command:');
    expect(messages(claudeMcpEntryProblems({ type: 'http' }))[0]).toStartWith('url:');
    expect(
      messages(claudeMcpEntryProblems({ type: 'http', url: 'x', oauth: { scopes: ['a'] } }))[0],
    ).toStartWith('oauth.scopes:');
    expect(
      messages(
        claudeMcpEntryProblems({
          type: 'http',
          url: 'x',
          oauth: { authServerMetadataUrl: 'http://insecure.example' },
        }),
      ).join('\n'),
    ).toContain('authServerMetadataUrl must use https://');
    expect(
      messages(
        claudeMcpEntryProblems({ type: 'http', url: 'x', toolPermissions: { a: 'maybe' } }),
      )[0],
    ).toStartWith('toolPermissions.a:');
    expect(messages(claudeMcpEntryProblems({ type: 5, command: 'x' }))[0]).toStartWith('type:');
  });

  it('flags a url without a type, and non-authorable or unknown types', () => {
    expect(messages(claudeMcpEntryProblems({ url: 'https://x' }))[0]).toContain(
      'has a `url` but no `type`',
    );
    expect(messages(claudeMcpEntryProblems({ type: 'sdk', name: 'x' }))[0]).toContain(
      'unknown type `sdk`',
    );
    expect(messages(claudeMcpEntryProblems({ type: '__proto__' }))[0]).toContain('unknown type');
  });
});

describe('unknownClaudeMcpFields', () => {
  it('reports fields the chosen transport does not read', () => {
    expect(unknownClaudeMcpFields({ type: 'http', url: 'x', mystery: 1, args: [] })).toEqual([
      'mystery',
      'args',
    ]);
    expect(unknownClaudeMcpFields({ type: 'ws', url: 'x', oauth: {} })).toEqual(['oauth']);
    expect(unknownClaudeMcpFields({ command: 'x', url: 'y' })).toEqual(['url']);
    expect(unknownClaudeMcpFields({ command: 'x', args: [] })).toEqual([]);
  });

  it('reports nothing when the transport cannot be determined', () => {
    expect(unknownClaudeMcpFields({ type: 'sdk', name: 'x' })).toEqual([]);
    expect(unknownClaudeMcpFields({ url: 'x', mystery: 1 })).toEqual([]);
  });
});

describe('codexMcpServerSchema', () => {
  const stdio = {
    command: 'npx',
    args: ['x'],
    env: { A: 'b' },
    env_vars: ['HOME', { name: 'X', source: 'remote' }],
    cwd: '/tmp',
  };
  const http = {
    url: 'https://x',
    bearer_token_env_var: 'T',
    http_headers: { A: 'b' },
    env_http_headers: { B: 'C' },
    http_headers_helper: 'echo {}',
    auth: 'oauth',
    oauth: { client_id: 'id', client_secret: 's', callback_port: 8080 },
    oauth_resource: 'r',
    scopes: ['a'],
  };
  const shared = {
    environment_id: 'local',
    startup_timeout_sec: 10,
    startup_timeout_ms: 500,
    tool_timeout_sec: 60,
    enabled: true,
    required: false,
    startup_readiness: 'catalog',
    supports_parallel_tool_calls: true,
    tool_input_schema_max_bytes: 100,
    omit_tools_from: ['code_mode'],
    default_tools_approval_mode: 'writes',
    enabled_tools: ['a'],
    disabled_tools: ['b'],
    tools: { a: { approval_mode: 'prompt', output_token_limit: 10 } },
    name: 'x',
  };

  it('accepts valid stdio and http sections', () => {
    expect(codexMcpProblems({ ...stdio, ...shared })).toEqual([]);
    expect(codexMcpProblems({ ...http, ...shared })).toEqual([]);
    expect(
      codexMcpProblems({
        url: 'https://x',
        auth: 'ema_auth',
        oauth: { authorization_server_issuer: 'i' },
      }),
    ).toEqual([]);
  });

  it('reports wrong types and values', () => {
    expect(messages(codexMcpProblems({ command: 'x', startup_readiness: 'soon' }))[0]).toStartWith(
      'startup_readiness:',
    );
    expect(messages(codexMcpProblems({ command: 'x', startup_timeout_sec: -1 }))[0]).toStartWith(
      'startup_timeout_sec:',
    );
    expect(
      messages(codexMcpProblems({ command: 'x', tool_input_schema_max_bytes: 0 }))[0],
    ).toStartWith('tool_input_schema_max_bytes:');
    expect(
      messages(codexMcpProblems({ command: 'x', default_tools_approval_mode: 'yolo' }))[0],
    ).toStartWith('default_tools_approval_mode:');
    expect(
      messages(codexMcpProblems({ command: 'x', env_vars: [{ name: 'A', source: 'cloud' }] }))[0],
    ).toStartWith('env_vars.0:');
    expect(
      messages(codexMcpProblems({ command: 'x', tools: { a: { approval_mode: 'no' } } }))[0],
    ).toStartWith('tools.a.approval_mode:');
    expect(
      messages(codexMcpProblems({ url: 'x', oauth: { callback_port: 70000 } }))[0],
    ).toStartWith('oauth.callback_port:');
  });

  it('enforces transport selection and cross-transport rules', () => {
    expect(messages(codexMcpProblems({})).join('\n')).toContain(
      'needs a `command` (stdio) or a `url`',
    );
    expect(messages(codexMcpProblems({ command: 'x', url: 'y' }))).toEqual([
      'url: not supported for a stdio server (`command` is set)',
    ]);
    expect(
      messages(codexMcpProblems({ command: 'x', auth: 'oauth', http_headers: {} })).length,
    ).toBe(2);
    expect(messages(codexMcpProblems({ url: 'y', args: ['a'], cwd: '/' })).length).toBe(2);
  });

  it('always rejects bearer_token', () => {
    expect(messages(codexMcpProblems({ url: 'y', bearer_token: 't' }))[0]).toContain(
      'bearer_token_env_var',
    );
    expect(messages(codexMcpProblems({ command: 'y', bearer_token: 't' })).length).toBe(1);
  });

  it('enforces oauth and header-helper cross-field rules', () => {
    expect(messages(codexMcpProblems({ url: 'y', oauth: { client_secret: 's' } }))[0]).toContain(
      'requires a non-blank `client_id`',
    );
    expect(
      messages(codexMcpProblems({ url: 'y', oauth: { client_secret: ' ', client_id: 'i' } }))[0],
    ).toContain('must not be blank');
    expect(
      messages(codexMcpProblems({ url: 'y', oauth: { authorization_server_issuer: 'i' } }))[0],
    ).toContain('requires `auth = "ema_auth"`');
    expect(messages(codexMcpProblems({ url: 'y', http_headers_helper: '  ' }))[0]).toContain(
      'must not be blank',
    );
    expect(
      messages(
        codexMcpProblems({ url: 'y', http_headers_helper: 'x', environment_id: 'remote' }),
      )[0],
    ).toContain('only supported for local');
  });
});

describe('codexMcpServerSchema fields', () => {
  it('types known fields, keeps unknown ones, and requires a transport', () => {
    expect(codexMcpServerSchema.parse({ command: 'x', startup_timeout_sec: 5, extra: 1 })).toEqual({
      command: 'x',
      startup_timeout_sec: 5,
      extra: 1,
    });
    expect(() => codexMcpServerSchema.parse({ command: 'x', required: 'yes' })).toThrow();
    expect(codexMcpServerSchema.safeParse({}).success).toBe(false);
  });
});

describe('nested unknown fields', () => {
  it('reports unknown keys inside a Claude oauth object', () => {
    expect(
      unknownClaudeMcpFields({ type: 'http', url: 'x', oauth: { clientId: 'a', clientid: 'b' } }),
    ).toEqual(['oauth.clientid']);
    expect(unknownClaudeMcpFields({ type: 'http', url: 'x', oauth: 'x' })).toEqual([]);
  });
});
