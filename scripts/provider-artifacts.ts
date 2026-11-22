import { z } from 'zod';

import { declarationContract } from './provider-contract-diff.js';

// Shared starting points for artifacts that still have open changes.
export const baseline = {
  codex: 'rust-v0.160.0',
  claude: 'v2.1.288',
  claudeSdk: '0.3.288',
  schemaStore: 'd2cbdcde9855c1bf9ea99c336163cc6c93753e39',
};

// The hook corpus changed by one schema (PreModelRequest and PostModelRequest).
// Both events were verified in the 0.171.0 CLI. See the provider format reference.
export const codexHookBaseline = 'rust-v0.171.0';

const codexRepository = 'openai/codex';
const claudeRepository = 'anthropics/claude-code';
const settingsPath = 'src/schemas/json/claude-code-settings.json';
const hooksDirectory = 'codex-rs/hooks/schema/generated';
const sdkPackage = '@anthropic-ai/claude-agent-sdk';

function raw(repository: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${repository}/${ref}/${path}`;
}

async function request(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return response;
}

async function json(url: string): Promise<unknown> {
  const response = await request(url);
  return response.json();
}

const stableVersion = /^\d+\.\d+\.\d+$/u;
const codexTag = z.string().regex(/^rust-v\d+\.\d+\.\d+$/u);
const claudeTag = z
  .string()
  .regex(/^v\d+\.\d+\.\d+$/u, 'Expected a stable Claude Code tag such as v2.1.330');
/** The published ambient declarations for one stable Claude Code release. */
export function claudeModDeclarationUrl(tag: string): string {
  return raw(claudeRepository, claudeTag.parse(tag), 'mods/types/claude-code.d.ts');
}

const commit = z.string().regex(/^[0-9a-f]{40}$/u);

async function latestRelease(repository: string): Promise<string | undefined> {
  const response = await request(`https://github.com/${repository}/releases/latest`);
  await response.body?.cancel();
  return new URL(response.url).pathname.split('/releases/tag/')[1];
}

async function latestSettingsCommit(): Promise<string> {
  const url = new URL('https://api.github.com/repos/SchemaStore/schemastore/commits');
  url.search = new URLSearchParams({ path: settingsPath, per_page: '1' }).toString();
  const [latest] = z.tuple([z.object({ sha: commit })]).parse(await json(url.href));
  return latest.sha;
}

const schemaRoot = z.object({ $schema: z.string() }).loose();
export type Artifact = { name: string; url: string; format: 'json' | 'typescript' };

async function codexHookArtifacts(tag: string): Promise<Artifact[]> {
  const url = `https://api.github.com/repos/${codexRepository}/contents/${hooksDirectory}?ref=${tag}`;
  return z
    .array(z.object({ name: z.string(), type: z.string() }))
    .nonempty()
    .parse(await json(url))
    .map(({ name, type }) => {
      if (type !== 'file' || !/^[\w.-]+\.schema\.json$/u.test(name)) {
        throw new Error(`Unexpected hook schema directory entry ${name} at ${tag}`);
      }
      return { name, url: raw(codexRepository, tag, `${hooksDirectory}/${name}`), format: 'json' };
    });
}

export const corpora = [
  'Codex configuration',
  'Codex hook payloads',
  'Codex App Server JSON-RPC',
  'Claude Code Mods',
  'Claude Agent SDK declarations',
  'Claude Code settings (SchemaStore)',
] as const;

export async function inventory(
  versions: typeof baseline,
  codexHookTag = versions.codex,
): Promise<Map<string, Artifact[]>> {
  return new Map([
    [
      corpora[0],
      [
        {
          name: 'config.schema.json',
          format: 'json',
          url: raw(codexRepository, versions.codex, 'codex-rs/core/config.schema.json'),
        },
      ],
    ],
    [corpora[1], await codexHookArtifacts(codexHookTag)],
    [
      corpora[2],
      [
        {
          name: 'codex_app_server_protocol.schemas.json',
          format: 'json',
          url: raw(
            codexRepository,
            versions.codex,
            'codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json',
          ),
        },
      ],
    ],
    [
      corpora[3],
      [
        {
          name: 'claude-code.d.ts',
          format: 'typescript',
          url: claudeModDeclarationUrl(versions.claude),
        },
      ],
    ],
    [
      corpora[4],
      [
        {
          name: 'sdk.d.ts',
          format: 'typescript',
          url: `https://unpkg.com/${sdkPackage}@${versions.claudeSdk}/sdk.d.ts`,
        },
      ],
    ],
    [
      corpora[5],
      [
        {
          name: 'claude-code-settings.json',
          format: 'json',
          url: raw('SchemaStore/schemastore', versions.schemaStore, settingsPath),
        },
      ],
    ],
  ]);
}

export function artifactReader() {
  const requests = new Map<string, Promise<unknown>>();
  return (artifact: Artifact): Promise<unknown> => {
    const cached = requests.get(artifact.url);
    if (cached) return cached;

    const pending = (async () => {
      try {
        const response = await request(artifact.url);
        if (artifact.format === 'typescript')
          return await declarationContract(await response.text());
        return schemaRoot.parse(await response.json());
      } catch (error) {
        throw new Error(`Could not load ${artifact.url}`, { cause: error });
      }
    })();
    requests.set(artifact.url, pending);
    return pending;
  };
}

export async function resolveTarget(values: {
  'codex-tag'?: string | undefined;
  'claude-tag'?: string | undefined;
  'claude-sdk-version'?: string | undefined;
  'settings-commit'?: string | undefined;
}) {
  const [codex, claude, claudeSdk, schemaStore] = await Promise.all([
    values['codex-tag'] ?? latestRelease(codexRepository),
    values['claude-tag'] ?? latestRelease(claudeRepository),
    values['claude-sdk-version'] ??
      json(`https://registry.npmjs.org/${sdkPackage}/latest`).then(
        (metadata) => z.object({ version: z.string() }).parse(metadata).version,
      ),
    values['settings-commit'] ?? latestSettingsCommit(),
  ]);
  return {
    codex: codexTag.parse(codex),
    claude: claudeTag.parse(claude),
    claudeSdk: z.string().regex(stableVersion).parse(claudeSdk),
    schemaStore: commit.parse(schemaStore),
  };
}
