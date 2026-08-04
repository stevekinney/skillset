import { parse } from 'yaml';
import { z } from 'zod';

import type { Issue } from './doctor.js';

const serverSchema = z.object({
  transport: z.enum(['stdio', 'http']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** Claude's per-server tool-call timeout, in milliseconds. */
  timeout: z.number().int().positive().optional(),
  /** Extra fields merged verbatim into the Claude entry (e.g. oauth). */
  claude: z.record(z.string(), z.unknown()).optional(),
  /** Extra fields merged verbatim into the Codex section; always win. */
  codex: z.record(z.string(), z.unknown()).optional(),
});

/** The mcp-servers.yaml source schema. */
export const mcpSourceSchema = z.object({
  servers: z.record(z.string(), serverSchema),
});

/** One validated server definition from mcp-servers.yaml. */
export type McpServer = z.infer<typeof serverSchema>;

/** The validated mcp-servers.yaml contents. */
export type McpSource = z.infer<typeof mcpSourceSchema>;

const KNOWN_SERVER_KEYS = new Set(Object.keys(serverSchema.shape));

/** A parsed mcp-servers.yaml with per-server unknown-key bookkeeping. */
export type ParsedMcpSource = {
  source: McpSource;
  /** `server-name.key` entries for keys neither tool understands. */
  unknownKeys: string[];
};

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate mcp-servers.yaml.
 *
 * @throws {Error} If the YAML is malformed or not a mapping.
 * @throws {z.ZodError} If the contents fail the schema.
 */
export function parseMcpSource(raw: string): ParsedMcpSource {
  const parsed: unknown = parse(raw);
  if (!isMapping(parsed)) throw new Error('mcp-servers.yaml must be a YAML mapping');

  const source = mcpSourceSchema.parse(parsed);

  const unknownKeys: string[] = [];
  const rawServers = parsed['servers'];
  if (isMapping(rawServers)) {
    for (const [name, definition] of Object.entries(rawServers)) {
      if (!isMapping(definition)) continue;

      for (const key of Object.keys(definition)) {
        if (!KNOWN_SERVER_KEYS.has(key)) unknownKeys.push(`${name}.${key}`);
      }
    }
  }

  return { source, unknownKeys };
}

/** The transport a server definition resolves to. */
export function resolveTransport(server: McpServer): 'stdio' | 'http' | undefined {
  if (server.transport) return server.transport;
  if (server.url) return 'http';
  if (server.command) return 'stdio';

  return undefined;
}

const FALLBACK_SYNTAX_PATTERN = /\$\{[A-Z_][A-Z0-9_]*:-[^}]*\}/;

function checkServer(name: string, server: McpServer): Issue[] {
  const issues: Issue[] = [];
  const transport = resolveTransport(server);

  if (!transport) {
    issues.push({
      severity: 'error',
      message: `server \`${name}\` needs a \`url\` (http) or a \`command\` (stdio)`,
    });
  }
  if (transport === 'http' && !server.url) {
    issues.push({ severity: 'error', message: `server \`${name}\` is http but has no \`url\`` });
  }
  if (transport === 'stdio' && !server.command) {
    issues.push({
      severity: 'error',
      message: `server \`${name}\` is stdio but has no \`command\``,
    });
  }
  if (server.url && server.command) {
    issues.push({
      severity: 'error',
      message: `server \`${name}\` sets both \`url\` and \`command\` — pick one transport`,
    });
  }

  if (FALLBACK_SYNTAX_PATTERN.test(JSON.stringify(server))) {
    issues.push({
      severity: 'warning',
      message: `server \`${name}\` uses \`\${VAR:-default}\` fallback syntax — Claude expands it, Codex cannot`,
    });
  }

  return issues;
}

/** Doctor checks for the MCP source: coherence, unknown keys, portability. */
export function checkMcpSource(parsed: ParsedMcpSource): Issue[] {
  const issues = Object.entries(parsed.source.servers).flatMap(([name, server]) =>
    checkServer(name, server),
  );

  for (const key of parsed.unknownKeys) {
    issues.push({
      severity: 'warning',
      message: `unknown server key \`${key}\` — neither tool understands it`,
    });
  }

  return issues;
}

/** Build the Claude `mcpServers` entry for one server. */
export function claudeMcpEntry(server: McpServer): Record<string, unknown> {
  const transport = resolveTransport(server);
  const entry: Record<string, unknown> = { type: transport };

  if (transport === 'http') {
    entry['url'] = server.url;
    if (server.headers) entry['headers'] = server.headers;
  } else {
    entry['command'] = server.command;
    if (server.args) entry['args'] = server.args;
    if (server.env) entry['env'] = server.env;
  }
  if (server.timeout !== undefined) entry['timeout'] = server.timeout;

  return { ...entry, ...server.claude };
}

const VARIABLE_ONLY_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;
const BEARER_VARIABLE_PATTERN = /^Bearer \$\{([A-Z_][A-Z0-9_]*)\}$/;

function splitCodexHeaders(headers: Record<string, string>): Record<string, unknown> {
  const section: Record<string, unknown> = {};
  const httpHeaders: Record<string, string> = {};
  const environmentHeaders: Record<string, string> = {};

  for (const [header, value] of Object.entries(headers)) {
    const bearer = BEARER_VARIABLE_PATTERN.exec(value);
    if (header === 'Authorization' && bearer) {
      section['bearer_token_env_var'] = bearer[1];
      continue;
    }

    const variable = VARIABLE_ONLY_PATTERN.exec(value);
    if (variable) {
      environmentHeaders[header] = variable[1]!;
    } else {
      httpHeaders[header] = value;
    }
  }

  if (Object.keys(httpHeaders).length > 0) section['http_headers'] = httpHeaders;
  if (Object.keys(environmentHeaders).length > 0) section['env_http_headers'] = environmentHeaders;

  return section;
}

function splitCodexEnvironment(env: Record<string, string>): Record<string, unknown> {
  const literals: Record<string, string> = {};
  const forwarded: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    const variable = VARIABLE_ONLY_PATTERN.exec(value);
    if (variable) {
      forwarded.push(variable[1]!);
    } else {
      literals[key] = value;
    }
  }

  const section: Record<string, unknown> = {};
  if (Object.keys(literals).length > 0) section['env'] = literals;
  if (forwarded.length > 0) section['env_vars'] = forwarded;

  return section;
}

/**
 * Build the Codex `[mcp_servers.<name>]` section for one server, applying the
 * documented Claude→Codex mappings (`Bearer ${VAR}` → `bearer_token_env_var`,
 * `${VAR}` headers → `env_http_headers`, `${VAR}` env values → `env_vars`,
 * `timeout` ms → `tool_timeout_sec`). Explicit `codex:` keys always win.
 */
export function codexMcpSection(server: McpServer): Record<string, unknown> {
  const transport = resolveTransport(server);
  let section: Record<string, unknown> = {};

  if (transport === 'http') {
    section['url'] = server.url;
    if (server.headers) section = { ...section, ...splitCodexHeaders(server.headers) };
  } else {
    section['command'] = server.command;
    if (server.args) section['args'] = server.args;
    if (server.env) section = { ...section, ...splitCodexEnvironment(server.env) };
  }
  if (server.timeout !== undefined) {
    section['tool_timeout_sec'] = Math.round(server.timeout / 1000);
  }

  return { ...section, ...server.codex };
}
