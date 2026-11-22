import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { z } from 'zod';

import { providerJsonSchemaFiles, providerJsonSchemaNames } from './provider-json-schemas.js';

const documentSchema = z.looseObject({
  $schema: z.literal('https://json-schema.org/draft/2020-12/schema'),
  $ref: z.string(),
  $defs: z.record(z.string(), z.unknown()),
});

const fixtures = {
  'claude-code.json': {
    record: { type: 'ai-title', sessionId: 'session-fixture', aiTitle: 'Fixture' },
    invalidRecord: { type: 'ai-title', sessionId: 'session-fixture', aiTitle: 42 },
    definition: 'claudeHookSpecificOutputSchemas.Stop',
    valid: { hookEventName: 'Stop' },
    invalid: { hookEventName: 'SessionStart' },
  },
  'codex.json': {
    record: {
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [] },
    },
    invalidRecord: {
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: false },
    },
    definition: 'codexHookOutputSchemas.Interrupt',
    valid: { systemMessage: 'Fixture' },
    invalid: { continue: true },
  },
} as const;

function checkSamples(
  check: ValidateFunction | undefined,
  name: string,
  valid: unknown,
  invalid: unknown,
) {
  if (!check) throw new Error(`Missing validator for ${name}`);
  if (!check(valid))
    throw new Error(`${name} rejected valid JSON: ${JSON.stringify(check.errors)}`);
  if (check(invalid)) throw new Error(`${name} accepted invalid JSON`);
}

/** Resolve, compile, and exercise the standalone schema exports from an installed tarball. */
export async function verifyPackedProviderJsonSchemas(directory: string, packageName: string) {
  const resolve = createRequire(join(directory, 'package.json')).resolve;
  for (const provider of providerJsonSchemaFiles) {
    const { file } = provider;
    // Compile each file independently. Draft 2020-12 treats format as an annotation by default.
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const specifier = `${packageName}/schemas/${file}`;
    const source: unknown = JSON.parse(await readFile(resolve(specifier), 'utf8'));
    const document = documentSchema.parse(source);
    if (document.$ref !== `#/$defs/${provider.root}`) {
      throw new Error(`Unexpected session record root in ${specifier}`);
    }
    ajv.addSchema(document, specifier);
    for (const { name } of providerJsonSchemaNames(provider)) {
      if (!Object.hasOwn(document.$defs, name) || !ajv.getSchema(`${specifier}#/$defs/${name}`)) {
        throw new Error(`Missing or unresolvable definition in ${specifier}: ${name}`);
      }
    }
    const { record, invalidRecord, definition, valid, invalid } = fixtures[file];
    checkSamples(ajv.getSchema(specifier), specifier, record, invalidRecord);
    checkSamples(ajv.getSchema(`${specifier}#/$defs/${definition}`), definition, valid, invalid);
  }
  console.log(
    'Verified standalone Claude Code and Codex JSON Schema exports in the packed package.',
  );
}
