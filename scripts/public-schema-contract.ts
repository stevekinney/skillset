type SchemaContract = {
  schema: string;
  type: string;
  guard: string;
  key?: string;
};

function isSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'safeParse' in value &&
    typeof value.safeParse === 'function'
  );
}

/** Derive the expected package symbols from every public schema and schema map. */
export function publicSchemaContracts(api: Record<string, unknown>): SchemaContract[] {
  return Object.entries(api).flatMap(([schema, value]): SchemaContract[] => {
    const type = schema.charAt(0).toUpperCase() + schema.slice(1).replace(/Schemas?$/u, '');
    if (isSchema(value)) {
      if (!schema.endsWith('Schema')) throw new Error(`Unexpected public schema name: ${schema}`);
      const guard = schema === 'claudeHookOutputSchema' ? 'isClaudeSyncHookOutput' : `is${type}`;
      return [{ schema, type, guard }];
    }
    if (!schema.endsWith('Schemas')) return [];
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Expected a public schema map: ${schema}`);
    }
    return Object.entries(value).map(([key, member]) => {
      if (!isSchema(member)) throw new Error(`Invalid public schema map entry: ${schema}.${key}`);
      return { schema, key, type: `${type}For`, guard: `is${type}For` };
    });
  });
}

/** Generate compile-time assertions against the declarations loaded from the installed tarball. */
export function publicSchemaTypeFixture(
  specifier: string,
  contracts: readonly SchemaContract[],
): string {
  const assertions = contracts.flatMap(({ schema, type, guard, key }, index) => {
    const member = key === undefined ? '' : `[${JSON.stringify(key)}]`;
    const argument = key === undefined ? '' : `<${JSON.stringify(key)}>`;
    const parameters =
      key === undefined ? 'value: unknown' : `key: ${JSON.stringify(key)}, value: unknown`;
    return [
      `// ${schema}${member}`,
      `type Input${index} = Input<typeof Api.${schema}${member}>;`,
      `type Output${index} = Output<typeof Api.${schema}${member}>;`,
      `type CheckType${index} = Assert<Equal<Api.${type}${argument}, Output${index}>>;`,
      `type CheckGuard${index} = Assert<Equal<typeof Api.${guard}${argument}, (${parameters}) => value is Input${index}>>;`,
    ];
  });
  return [
    `import type * as Api from ${JSON.stringify(specifier)};`,
    'import type { input as Input, output as Output } from "zod";',
    'type Assert<T extends true> = T;',
    'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',
    ...assertions,
  ].join('\n');
}

/** Generate runtime probes for the public schema and guard bindings in the installed tarball. */
export function publicSchemaRuntimeFixture(
  specifier: string,
  contracts: readonly SchemaContract[],
): string {
  return `
    const api = await import(${JSON.stringify(specifier)});
    for (const { schema, guard, key } of ${JSON.stringify(contracts)}) {
      const value = key === undefined ? api[schema] : api[schema]?.[key];
      const name = key === undefined ? schema : schema + '.' + key;
      if (typeof value?.safeParse !== 'function') throw new Error('Missing schema: ' + name);
      if (typeof api[guard] !== 'function') throw new Error('Missing guard: ' + guard);
      for (const sample of [undefined, null, {}, { async: true }, 'low', -1]) {
        const actual = key === undefined ? api[guard](sample) : api[guard](key, sample);
        if (actual !== value.safeParse(sample).success) throw new Error(guard + ' disagrees with ' + name);
      }
    }
  `;
}
