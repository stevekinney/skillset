import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

import packageDefinition from '../package.json' with { type: 'json' };
import { analysisHasErrors, analysisReport, analyzeSources } from './analysis.js';
import type { CliDependencies } from './cli.js';
import { runImport, runSync, targetStatuses, type RunContext } from './commands-run.js';
import {
  getField,
  listEntries,
  newSource,
  removeSource,
  setField,
  showSource,
} from './commands.js';
import { resolveSourceRoot } from './discover.js';
import { parseEnvironment } from './environment.js';
import type { Invocation } from './invocation.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, undefined, 2) }] };
}

function errorResult(cause: unknown): ToolResult {
  const message = cause instanceof Error ? cause.message : String(cause);

  return { content: [{ type: 'text', text: message }], isError: true };
}

async function guarded(handler: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await handler();
  } catch (cause) {
    return errorResult(cause);
  }
}

const scopeShape = z.enum(['user', 'project']).default('user');
const targetShape = z.enum(['claude', 'codex']).optional();
const crudKindShape = z.enum(['skill', 'agent']);

function baseInvocation(overrides: Partial<Invocation>): Invocation {
  return {
    command: 'sync',
    dryRun: false,
    prune: false,
    force: false,
    json: true,
    checkTargets: false,
    scope: 'user',
    targets: ['claude', 'codex'],
    ...overrides,
  };
}

/**
 * Build the skillset MCP server: every CLI operation exposed as a tool with
 * the same JSON shapes as the CLI's `--json` output, so agents can manage
 * sources and syncs over MCP instead of shelling out.
 */
export function createMcpServer(dependencies: CliDependencies): McpServer {
  const server = new McpServer({ name: 'skillset', version: packageDefinition.version });

  const context = (): RunContext => {
    const skillsetDirectory = parseEnvironment(dependencies.env).SKILLSET_DIRECTORY;

    return {
      cwd: dependencies.cwd,
      homeDirectory: dependencies.homeDirectory,
      ...(skillsetDirectory === undefined ? {} : { skillsetDirectory }),
      log: dependencies.log,
    };
  };
  const analyze = async () => analyzeSources(context().skillsetDirectory, dependencies.cwd);
  const sourceRoot = (): string => resolveSourceRoot(context().skillsetDirectory, dependencies.cwd);

  server.registerTool(
    'list_sources',
    {
      description:
        'List every source (skills, agents, MCP servers) in the skillset source root with its doctor status.',
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        const { sources } = await analyze();

        return jsonResult(listEntries(sources));
      }),
  );

  server.registerTool(
    'run_doctor',
    {
      description:
        'Validate every source and return the full report: per-skill and per-agent issues plus per-file issues for mcp-servers.yaml, instructions.md, hooks.yaml, and defaults.yaml.',
      inputSchema: {},
    },
    async () => guarded(async () => jsonResult(analysisReport(await analyze()))),
  );

  server.registerTool(
    'check_targets',
    {
      description:
        'Audit every skillset-managed output against the sync ledger and report each as clean, drift (hand-edited since last sync), or missing.',
      inputSchema: { scope: scopeShape },
    },
    async ({ scope }) =>
      guarded(async () => {
        const rows = await targetStatuses(scope, context());

        return jsonResult(rows.map(({ key, item, status }) => ({ ...item, path: key, status })));
      }),
  );

  server.registerTool(
    'sync',
    {
      description:
        'Compile the sources into Claude Code and Codex config. Set dry_run to preview the action plan without writing. Skips hand-installed (unmanaged) and hand-edited (drifted) outputs unless force is set. Prune removes previously generated outputs whose sources were deleted.',
      inputSchema: {
        scope: scopeShape,
        target: targetShape,
        kind: z.enum(['skills', 'agents', 'mcp', 'instructions', 'hooks', 'defaults']).optional(),
        dry_run: z.boolean().default(false),
        prune: z.boolean().default(false),
        force: z.boolean().default(false),
      },
    },
    async ({ scope, target, kind, dry_run, prune, force }) =>
      guarded(async () => {
        const analysis = await analyze();
        if (analysisHasErrors(analysis)) {
          return {
            ...jsonResult({
              error: 'sync aborted — sources have errors',
              report: analysisReport(analysis),
            }),
            isError: true,
          };
        }

        const lines: string[] = [];
        const invocation = baseInvocation({
          dryRun: dry_run,
          prune,
          force,
          scope,
          targets: target ? [target] : ['claude', 'codex'],
          ...(kind === undefined ? {} : { kind }),
        });
        await runSync(invocation, analysis, { ...context(), log: (line) => lines.push(line) });

        return jsonResult(JSON.parse(lines.join('\n')));
      }),
  );

  server.registerTool(
    'show_source',
    {
      description:
        'Compile a named skill, agent, or MCP server and return the per-target output (Claude and/or Codex) without writing anything.',
      inputSchema: { name: z.string(), target: targetShape },
    },
    async ({ name, target }) =>
      guarded(async () => {
        const analysis = await analyze();

        return jsonResult(
          showSource(analysis.sources, name, target ? [target] : ['claude', 'codex']),
        );
      }),
  );

  server.registerTool(
    'new_source',
    {
      description: 'Scaffold a new skill or agent source with doctor-clean frontmatter.',
      inputSchema: { kind: crudKindShape, name: z.string() },
    },
    async ({ kind, name }) =>
      guarded(async () => jsonResult({ created: await newSource(sourceRoot(), kind, name) })),
  );

  server.registerTool(
    'remove_source',
    {
      description:
        'Delete a skill or agent source. Generated outputs remain until a sync with prune.',
      inputSchema: { kind: crudKindShape, name: z.string() },
    },
    async ({ kind, name }) =>
      guarded(async () => jsonResult({ removed: await removeSource(sourceRoot(), kind, name) })),
  );

  server.registerTool(
    'get_field',
    {
      description:
        'Read a skill or agent frontmatter mapping, or one field of it via a dot path (e.g. openai.interface.display_name).',
      inputSchema: { kind: crudKindShape, name: z.string(), path: z.string().optional() },
    },
    async ({ kind, name, path }) =>
      guarded(async () =>
        jsonResult({ value: (await getField(sourceRoot(), kind, name, path)) ?? null }),
      ),
  );

  server.registerTool(
    'set_field',
    {
      description:
        'Set one frontmatter field via a dot path. The value is parsed as YAML (so `true`, `5`, and lists work) and the write is validated against the union schema first; an empty value deletes the field.',
      inputSchema: { kind: crudKindShape, name: z.string(), path: z.string(), value: z.string() },
    },
    async ({ kind, name, path, value }) =>
      guarded(async () => {
        await setField(sourceRoot(), kind, name, path, value);

        return jsonResult({ set: path, on: `${kind} ${name}` });
      }),
  );

  server.registerTool(
    'import_source',
    {
      description:
        'Adopt a hand-installed skill, agent, or instructions file: reverse-compile it into a source, then force-sync that item so the existing targets become skillset-managed.',
      inputSchema: {
        kind: z.enum(['skill', 'agent', 'instructions']),
        name: z.string().optional(),
        from: z.enum(['claude', 'codex']).default('claude'),
        scope: scopeShape,
      },
    },
    async ({ kind, name, from, scope }) =>
      guarded(async () => {
        const lines: string[] = [];
        const invocation = baseInvocation({
          command: 'import',
          importKind: kind,
          from,
          scope,
          json: false,
          ...(name === undefined ? {} : { name }),
        });
        const code = await runImport(invocation, { ...context(), log: (line) => lines.push(line) });

        return {
          ...jsonResult({ ok: code === 0, log: lines }),
          ...(code === 0 ? {} : { isError: true }),
        };
      }),
  );

  return server;
}

/** Construct the stdio transport (separate so tests can cover it safely). */
export function createStdioTransport(): Transport {
  return new StdioServerTransport();
}

/**
 * Run the MCP server until the transport closes. The default transport
 * speaks MCP over stdio, which is what `skillset mcp` exposes.
 */
export async function runMcpServer(
  dependencies: CliDependencies,
  transport: Transport = createStdioTransport(),
): Promise<number> {
  const server = createMcpServer(dependencies);

  const closed = new Promise<void>((resolve) => {
    const previous = transport.onclose;
    // Transport's close notification is a plain callback property, not a DOM
    // EventTarget — chaining it (rather than replacing it) is the pattern the
    // SDK's own Protocol.connect() uses internally to add its own handler
    // without clobbering one a caller already set.
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = () => {
      previous?.();
      resolve();
    };
  });

  await server.connect(transport);
  await closed;

  return 0;
}
