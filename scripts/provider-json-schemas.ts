import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import * as publicApi from '../src/index.js';
import { publicSchemaContracts } from './public-schema-contract.js';

export const providerJsonSchemaFiles = [
  {
    file: 'claude-code.json',
    title: 'Claude Code',
    prefix: 'claude',
    root: 'claudeSessionRecordSchema',
  },
  { file: 'codex.json', title: 'Codex', prefix: 'codex', root: 'codexSessionRecordSchema' },
] as const;

type Provider = (typeof providerJsonSchemaFiles)[number];

const api: Record<string, unknown> = publicApi;
const contracts = publicSchemaContracts(api);
const dialect = 'https://json-schema.org/draft/2020-12/schema';

function reference(name: string): string {
  return `#/$defs/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function schemaFor(schema: string, key: string | undefined): z.ZodType {
  const value = api[schema];
  const member =
    key === undefined ? value : Object.entries(value ?? {}).find(([name]) => name === key)?.[1];
  if (!(member instanceof z.ZodType)) throw new Error(`Expected a Zod schema for ${schema}`);
  return member;
}

/** The public JSON-representable definitions expected in a provider file. */
export function providerJsonSchemaNames(provider: Provider) {
  return contracts
    .filter(({ schema }) => {
      // The workflow budget API includes callable methods.
      if (schema === 'claudeWorkflowBudgetSchema') return false;
      return !schema.startsWith(provider.prefix === 'claude' ? 'codex' : 'claude');
    })
    .map(({ schema, key }) => ({
      schema,
      key,
      name: key === undefined ? schema : `${schema}.${key}`,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name, 'en'));
}

function bundle(provider: Provider) {
  const registry = z.registry<{ id: string }>();
  const registered = new Map<z.ZodType, string>();
  const aliases: Record<string, { $ref: string }> = {};
  for (const { schema, key, name } of providerJsonSchemaNames(provider)) {
    const value = schemaFor(schema, key);
    const existing = registered.get(value);
    if (existing !== undefined) {
      aliases[name] = { $ref: reference(existing) };
    } else {
      registry.add(value, { id: name });
      registered.set(value, name);
    }
  }

  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io: 'output',
    reused: 'ref',
    uri: (id) => (id === '__shared' ? '' : reference(id)),
  });
  const { __shared, ...named } = schemas;
  const definitions = Object.fromEntries(
    Object.entries(named).map(([name, { $id: _id, $schema: _schema, ...definition }]) => [
      name,
      definition,
    ]),
  );

  return {
    $schema: dialect,
    title: `Skillset ${provider.title} JSON schemas`,
    description:
      'Structural schemas for parsed JSON values. The root validates one session record. Use $defs to select a configuration, hook, or payload schema. JavaScript parsing and refinements are handled by Skillset.',
    $ref: reference(provider.root),
    $defs: { ...definitions, ...aliases, ...__shared?.$defs },
  };
}

/** Write the standalone provider files alongside the other build artifacts. */
export async function writeProviderJsonSchemas(directory: string) {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    providerJsonSchemaFiles.map((provider) =>
      Bun.write(join(directory, provider.file), `${JSON.stringify(bundle(provider), null, 2)}\n`),
    ),
  );
}
