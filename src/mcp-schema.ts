import { z } from 'zod';

import { isMapping } from './frontmatter.js';

/** One validation finding: where in the entry, and what is wrong. */
export type McpProblem = { path: PropertyKey[]; message: string };

// Claude Code's MCP server entry, transcribed from the 2.1.288 binary's own
// Zod definitions (verified October 2026). Objects are loose so fields Claude
// Code does not read survive into the emitted output; doctor reports them as
// warnings through unknownClaudeMcpFields. The internal `role` and
// `request_timeout_ms` fields are accepted but not validated, because Claude
// Code itself coerces invalid values to undefined.
const positiveInteger = z.number().int().positive();
const stringRecord = z.record(z.string(), z.string());

const claudeOAuthSchema = z.looseObject({
  clientId: z.string().optional(),
  callbackPort: positiveInteger.optional(),
  authServerMetadataUrl: z
    .url()
    .startsWith('https://', 'authServerMetadataUrl must use https://')
    .optional(),
  /** A single space-separated string (RFC 6749), not an array. */
  scopes: z.string().min(1).optional(),
  xaa: z.boolean().optional(),
});

const commonClaudeFields = {
  /** Per-server tool-call timeout in milliseconds. */
  timeout: positiveInteger.optional(),
  alwaysLoad: z.boolean().optional(),
  bareElicitationCapability: z.boolean().optional(),
  role: z.unknown().optional(),
};

const stdioFields = {
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: stringRecord.optional(),
  ...commonClaudeFields,
};

const webSocketFields = {
  url: z.string(),
  headers: stringRecord.optional(),
  headersHelper: z.string().optional(),
  ...commonClaudeFields,
};

const remoteFields = {
  ...webSocketFields,
  oauth: claudeOAuthSchema.optional(),
  request_timeout_ms: z.unknown().optional(),
  tools: z
    .array(
      z.looseObject({
        name: z.string(),
        permission_policy: z.enum(['always_allow', 'always_ask', 'always_deny']).optional(),
      }),
    )
    .optional(),
  discoveryCache: z.boolean().optional(),
  toolPermissions: z.record(z.string(), z.enum(['allow', 'ask', 'blocked'])).optional(),
};

const claudeStdioSchema = z.looseObject({ type: z.literal('stdio').optional(), ...stdioFields });
const claudeSseSchema = z.looseObject({ type: z.literal('sse'), ...remoteFields });
const claudeHttpSchema = z.looseObject({
  type: z.enum(['http', 'streamable-http']),
  ...remoteFields,
});
const claudeWebSocketSchema = z.looseObject({ type: z.literal('ws'), ...webSocketFields });

const CLAUDE_ENTRY_SCHEMAS = new Map<string, z.ZodObject>([
  ['stdio', claudeStdioSchema],
  ['sse', claudeSseSchema],
  ['http', claudeHttpSchema],
  ['streamable-http', claudeHttpSchema],
  ['ws', claudeWebSocketSchema],
]);

/**
 * The `claude:` block of an mcp-servers.yaml server: any field of any
 * authorable Claude transport, all optional. The merged entry is validated
 * against its transport afterwards, because the base fields decide which
 * transport the block lands on.
 */
export const claudeMcpOverrideSchema = z
  .looseObject({
    type: z.enum(['stdio', 'sse', 'http', 'streamable-http', 'ws']),
    ...stdioFields,
    ...remoteFields,
  })
  .partial();

function entryType(entry: Record<string, unknown>): string | undefined {
  return typeof entry['type'] === 'string' ? entry['type'] : undefined;
}

function claudeSchemaFor(entry: Record<string, unknown>): z.ZodObject | undefined {
  return CLAUDE_ENTRY_SCHEMAS.get(entryType(entry) ?? 'stdio');
}

/**
 * Validate one Claude `mcpServers` entry the way Claude Code's loader does:
 * the `type` picks the schema (absent means stdio), a `url` without a `type`
 * is skipped, and sdk/sse-ide/ws-ide entries are skipped when read from files.
 */
export function claudeMcpEntryProblems(entry: Record<string, unknown>): McpProblem[] {
  const type = entryType(entry);

  if (type === undefined && entry['url'] !== undefined && entry['command'] === undefined) {
    return [
      {
        path: ['type'],
        message:
          'has a `url` but no `type` — Claude Code skips the entry; add `type: http` (or `sse` / `ws`)',
      },
    ];
  }

  const schema = claudeSchemaFor(entry);
  if (!schema) {
    return [
      {
        path: ['type'],
        message: `unknown type \`${type}\` — Claude Code skips the entry; authorable types are stdio, sse, http (or streamable-http), and ws`,
      },
    ];
  }

  const result = schema.safeParse(entry);
  if (result.success) return [];

  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

/** Fields of a Claude entry that its transport does not read. */
export function unknownClaudeMcpFields(entry: Record<string, unknown>): string[] {
  const schema = claudeSchemaFor(entry);
  if (!schema || (entryType(entry) === undefined && entry['command'] === undefined)) return [];

  return Object.keys(entry).filter((key) => !(key in schema.shape));
}

/**
 * One item of a Claude subagent's `mcpServers` list: the name of an
 * already-configured server, or a mapping from a server name to a full inline
 * entry. Claude Code requires exactly one key per mapping at load time rather
 * than in its schema, so doctor reports that rule as a warning.
 */
export const claudeAgentMcpServerSchema = z
  .custom<string | Record<string, Record<string, unknown>>>()
  .superRefine((item, context) => {
    if (typeof item === 'string') return;

    if (!isMapping(item)) {
      context.addIssue({
        code: 'custom',
        message: 'expected a server name or a mapping of one server name to its entry',
      });
      return;
    }

    for (const [name, entry] of Object.entries(item)) {
      if (!isMapping(entry)) {
        context.addIssue({ code: 'custom', path: [name], message: 'expected a server entry' });
        continue;
      }

      for (const problem of claudeMcpEntryProblems(entry)) {
        context.addIssue({
          code: 'custom',
          path: [name, ...problem.path],
          message: problem.message,
        });
      }
    }
  });

// Codex 0.160.0's `[mcp_servers.<name>]` table (verified October 2026 against
// config.schema.json and mcp_types.rs at rust-v0.160.0). Unknown keys are
// ignored at runtime but flagged by Codex's published JSON schema, so they are
// kept and reported as doctor warnings.
const codexApprovalMode = z.enum(['auto', 'prompt', 'writes', 'approve']);

const codexFields = {
  // Stdio transport (selected by `command`).
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: stringRecord.optional(),
  env_vars: z
    .array(
      z.union([
        z.string(),
        z.looseObject({ name: z.string(), source: z.enum(['local', 'remote']).optional() }),
      ]),
    )
    .optional(),
  cwd: z.string().optional(),
  // Streamable HTTP transport (selected by `url`).
  url: z.string().optional(),
  bearer_token_env_var: z.string().optional(),
  http_headers: stringRecord.optional(),
  env_http_headers: stringRecord.optional(),
  http_headers_helper: z.string().optional(),
  auth: z.enum(['oauth', 'chatgpt', 'ema_auth']).optional(),
  oauth: z
    .looseObject({
      client_id: z.string().optional(),
      client_secret: z.string().optional(),
      callback_url: z.string().optional(),
      callback_port: z.number().int().min(0).max(65_535).optional(),
      authorization_server_issuer: z.string().optional(),
    })
    .optional(),
  oauth_resource: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  // Either transport.
  environment_id: z.string().optional(),
  startup_timeout_sec: z.number().min(0).optional(),
  startup_timeout_ms: z.number().int().min(0).optional(),
  tool_timeout_sec: z.number().optional(),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  startup_readiness: z.enum(['connection', 'catalog']).optional(),
  supports_parallel_tool_calls: z.boolean().optional(),
  tool_input_schema_max_bytes: z.number().int().min(1).optional(),
  omit_tools_from: z.array(z.enum(['code_mode', 'deferred', 'direct'])).optional(),
  default_tools_approval_mode: codexApprovalMode.optional(),
  enabled_tools: z.array(z.string()).optional(),
  disabled_tools: z.array(z.string()).optional(),
  tools: z
    .record(
      z.string(),
      z.looseObject({
        approval_mode: codexApprovalMode.optional(),
        output_token_limit: z.number().int().min(1).optional(),
      }),
    )
    .optional(),
  name: z.string().optional(),
};

/**
 * The `codex:` block of an mcp-servers.yaml server, and the field set of a
 * Codex section: every field optional, no transport rules applied yet.
 */
export const codexMcpFieldsSchema = z.looseObject(codexFields);

const STDIO_REJECTED_FIELDS = [
  'url',
  'bearer_token_env_var',
  'http_headers_helper',
  'http_headers',
  'env_http_headers',
  'oauth',
  'oauth_resource',
  'auth',
] as const;

const HTTP_REJECTED_FIELDS = ['args', 'env', 'env_vars', 'cwd'] as const;

function isBlank(value: string | undefined): boolean {
  return value !== undefined && value.trim().length === 0;
}

type CodexSection = z.infer<typeof codexMcpFieldsSchema>;
type Reject = (field: string, message: string) => void;

function isPresent(section: object, field: string): boolean {
  return Object.entries(section).some(([key, value]) => key === field && value !== undefined);
}

function rejectFields(
  section: CodexSection,
  fields: readonly string[],
  transport: string,
  reject: Reject,
): void {
  for (const field of fields) {
    if (isPresent(section, field)) reject(field, `not supported for a ${transport}`);
  }
}

function checkCodexTransport(section: CodexSection, reject: Reject): void {
  if (isPresent(section, 'bearer_token')) {
    reject('bearer_token', 'bearer_token is never accepted — use `bearer_token_env_var`');
  }

  if (section.command !== undefined) {
    rejectFields(section, STDIO_REJECTED_FIELDS, 'stdio server (`command` is set)', reject);
  } else if (section.url !== undefined) {
    rejectFields(section, HTTP_REJECTED_FIELDS, 'streamable HTTP server (`url` is set)', reject);
  } else {
    reject('command', 'needs a `command` (stdio) or a `url` (streamable HTTP)');
  }
}

function checkCodexOAuth(section: CodexSection, reject: Reject): void {
  const { oauth } = section;

  if (isBlank(oauth?.client_secret)) {
    reject('oauth.client_secret', 'must not be blank');
  } else if (oauth?.client_secret !== undefined && (oauth.client_id ?? '').trim() === '') {
    reject('oauth.client_secret', 'requires a non-blank `client_id`');
  }
  if (oauth?.authorization_server_issuer !== undefined && section.auth !== 'ema_auth') {
    reject('oauth.authorization_server_issuer', 'requires `auth = "ema_auth"`');
  }
}

function checkCodexHeadersHelper(section: CodexSection, reject: Reject): void {
  if (isBlank(section.http_headers_helper)) {
    reject('http_headers_helper', 'must not be blank');
  }
  if (
    section.http_headers_helper !== undefined &&
    section.environment_id !== undefined &&
    section.environment_id !== 'local'
  ) {
    reject(
      'http_headers_helper',
      'only supported for local servers (`environment_id` is not "local")',
    );
  }
}

/** A complete Codex `[mcp_servers.<name>]` section, including its transport rules. */
export const codexMcpServerSchema = codexMcpFieldsSchema.superRefine((section, context) => {
  const reject: Reject = (field, message) => {
    context.addIssue({ code: 'custom', path: [field], message });
  };

  checkCodexTransport(section, reject);
  checkCodexOAuth(section, reject);
  checkCodexHeadersHelper(section, reject);
});

/** Validate one Codex `[mcp_servers.<name>]` section. */
export function codexMcpProblems(section: Record<string, unknown>): McpProblem[] {
  const result = codexMcpServerSchema.safeParse(section);
  if (result.success) return [];

  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

const CODEX_FIELD_HINTS = new Map([
  [
    'experimental_environment',
    'Codex 0.160 renamed it to `environment_id` (the public docs still show the old name)',
  ],
]);

/** An explanation for a well-known unknown Codex field, such as a renamed one. */
export function codexUnknownFieldHint(field: string): string | undefined {
  return CODEX_FIELD_HINTS.get(field);
}

/** Top-level fields of a Codex section that Codex does not read. */
export function unknownCodexMcpFields(section: Record<string, unknown>): string[] {
  return Object.keys(section).filter(
    (key) => key !== 'bearer_token' && !(key in codexMcpFieldsSchema.shape),
  );
}
