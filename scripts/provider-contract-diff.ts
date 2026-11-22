import { format } from 'prettier';
import { parsers } from 'prettier/plugins/typescript';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const schemaAnnotations = new Set([
  '$comment',
  'description',
  'examples',
  'markdownDescription',
  'title',
]);
const schemaMaps = new Set([
  '$defs',
  'definitions',
  'properties',
  'patternProperties',
  'dependentSchemas',
]);

function stringConstant(field: unknown): string | undefined {
  if (!object(field)) return undefined;
  const values = field['enum'];
  const constant = field['const'] ?? (Array.isArray(values) && values.length === 1 && values[0]);
  return typeof constant === 'string' ? constant : undefined;
}

function discriminator(properties: unknown): string | undefined {
  if (!object(properties)) return undefined;
  for (const key of Object.keys(properties).toSorted()) {
    const constant = stringConstant(properties[key]);
    if (constant !== undefined) return `${key}=${constant}`;
  }
  return undefined;
}

function schemaVariant(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const tag = discriminator(value['properties']);
  if (tag !== undefined) return tag;
  const reference = value['$ref'];
  if (typeof reference === 'string') return reference;
  const type = value['type'];
  return typeof type === 'string' ? `type=${type}` : undefined;
}

function indexUnique(
  values: unknown[],
  name: (entry: unknown) => string | undefined,
): Record<string, unknown> | undefined {
  const names = values.map(name);
  if (values.length === 0 || names.some((key) => key === undefined)) return undefined;
  if (new Set(names).size !== names.length) return undefined;
  return Object.fromEntries(values.map((entry, index) => [names[index], entry]));
}

function normalizeKeyword(key: string, entry: unknown): unknown {
  if (
    Array.isArray(entry) &&
    ['required', 'enum', 'type'].includes(key) &&
    entry.every((item) => typeof item === 'string')
  ) {
    return Object.fromEntries(entry.map((item: string) => [item, true]));
  }
  if (Array.isArray(entry) && ['oneOf', 'anyOf', 'allOf'].includes(key)) {
    const variants = indexUnique(entry, schemaVariant);
    if (variants) return normalizeSchema(variants, true);
  }
  // These keywords carry instance values, whose property names are not schema keywords.
  if (['default', 'const', 'enum'].includes(key)) return entry;
  return normalizeSchema(entry, schemaMaps.has(key));
}

/** Keep schema keywords and preserve the names of schema fields and definitions. */
export function normalizeSchema(value: unknown, namedEntries = false): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeSchema(entry));
  if (!object(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => namedEntries || !schemaAnnotations.has(key))
      .map(([key, entry]) => [
        key,
        namedEntries ? normalizeSchema(entry) : normalizeKeyword(key, entry),
      ]),
  );
}

const astMetadata = new Set(['loc', 'range', 'raw', 'comments', 'tokens', 'parent']);

function identifier(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const name = value['name'] ?? value['value'];
  return typeof name === 'string' || typeof name === 'number' ? String(name) : undefined;
}

function indexSignatureName(parameters: unknown): string | undefined {
  if (!Array.isArray(parameters) || parameters.length !== 1 || !object(parameters[0])) {
    return undefined;
  }
  const annotation = parameters[0]['typeAnnotation'];
  if (!object(annotation) || !object(annotation['typeAnnotation'])) return undefined;
  const kind = annotation['typeAnnotation']['type'];
  if (kind === 'TSStringKeyword' || kind === 'TSNumberKeyword' || kind === 'TSSymbolKeyword') {
    return `[index:${kind}]`;
  }
  return undefined;
}

function bindingName(value: Record<string, unknown>): string | undefined {
  switch (value['type']) {
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return identifier(value['local']);
    case 'ExportSpecifier':
      return identifier(value['exported']);
    default:
      return undefined;
  }
}

function singleVariableName(declarations: unknown): string | undefined {
  return Array.isArray(declarations) && declarations.length === 1
    ? declarationName(declarations[0])
    : undefined;
}

function declarationName(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const source = identifier(value['source']);
  if (value['type'] === 'ImportDeclaration') return `import from ${source}`;
  if (value['type'] === 'ExportNamedDeclaration') {
    return source === undefined ? declarationName(value['declaration']) : `export from ${source}`;
  }
  if (value['type'] === 'VariableDeclaration') {
    return singleVariableName(value['declarations']);
  }
  if (value['type'] === 'TSIndexSignature') return indexSignatureName(value['parameters']);
  return identifier(value['id']) ?? identifier(value['key']) ?? bindingName(value);
}

function normalizeDeclaration(value: unknown): unknown {
  if (Array.isArray(value)) {
    const named = indexUnique(value, declarationName);
    return named ? normalizeDeclaration(named) : value.map(normalizeDeclaration);
  }
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !astMetadata.has(key) && !key.startsWith('__'))
      .map(([key, entry]) => [key, normalizeDeclaration(entry)]),
  );
}

function indexDeclarations(nodes: unknown[]): Record<string, unknown> {
  const declarations = new Map<string, unknown[]>();
  const modules = new Map<string, unknown[]>();
  for (const entry of nodes) {
    if (!object(entry) || typeof entry['type'] !== 'string') throw new Error('Invalid AST node');
    const name = declarationName(entry) ?? entry['type'];
    const body = entry['body'];
    if (entry['type'] === 'TSModuleDeclaration' && object(body) && Array.isArray(body['body'])) {
      const contents = modules.get(name) ?? [];
      contents.push(...body['body']);
      modules.set(name, contents);
    } else {
      const group = declarations.get(name) ?? [];
      group.push(normalizeDeclaration(entry));
      declarations.set(name, group);
    }
  }
  return {
    ...Object.fromEntries(declarations),
    ...Object.fromEntries(
      [...modules].map(([name, contents]) => [`module ${name}`, indexDeclarations(contents)]),
    ),
  };
}

/** Index declaration syntax without comments or formatting. Keep overloads in source order. */
export async function declarationContract(source: string) {
  let parsed: unknown;
  // Let Prettier supply its parser options. The printer only consumes a
  // placeholder because the parsed declaration nodes are the output we need.
  await format(source, {
    filepath: 'provider.d.ts',
    parser: 'provider-contract',
    plugins: [
      {
        parsers: {
          'provider-contract': {
            ...parsers.typescript,
            astFormat: 'provider-contract',
            async parse(input, options) {
              parsed = await parsers.typescript.parse(input, options);
              return { range: [0, input.length] };
            },
          },
        },
        printers: { 'provider-contract': { print: () => '' } },
      },
    ],
  });
  if (!object(parsed) || !Array.isArray(parsed['body']) || parsed['body'].length === 0) {
    throw new Error('Expected a nonempty TypeScript declaration file');
  }

  return indexDeclarations(parsed['body']);
}

export type ContractChange = {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  before?: unknown;
  after?: unknown;
};

function entries(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return Object.fromEntries(value.entries());
  return object(value) ? value : undefined;
}

function diffValues(before: unknown, after: unknown, path = ''): ContractChange[] {
  if (Object.is(before, after)) return [];

  const left = entries(before);
  const right = entries(after);
  if (left && right && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].toSorted().flatMap((key) => {
      const child = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (!Object.hasOwn(left, key)) return [{ kind: 'added', path: child, after: right[key] }];
      if (!Object.hasOwn(right, key)) return [{ kind: 'removed', path: child, before: left[key] }];
      return diffValues(left[key], right[key], child);
    });
  }

  return [
    {
      kind: 'changed',
      path: path || '/',
      before,
      after,
    },
  ];
}

function displayChange({ kind, path, before, after }: ContractChange): ContractChange {
  return {
    kind,
    path,
    ...(before !== undefined && (typeof before !== 'object' || before === null) ? { before } : {}),
    ...(after !== undefined && (typeof after !== 'object' || after === null) ? { after } : {}),
  };
}

/** Return stable JSON Pointer paths with primitive values where available. */
export function diffContracts(before: unknown, after: unknown): ContractChange[] {
  return diffValues(before, after).map(displayChange);
}

/** Hash both normalized values so a repeat change at the same path needs its own review. */
export function identifyChange(change: ContractChange): ContractChange & { fingerprint: string } {
  const canonical = JSON.stringify(change, (_key, value: unknown) =>
    object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .toSorted()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
  return {
    ...displayChange(change),
    fingerprint: new Bun.CryptoHasher('sha256').update(canonical).digest('hex'),
  };
}

/** Compare normalized contracts with fingerprints suitable for recording a focused review. */
export function identifyContractChanges(before: unknown, after: unknown) {
  return diffValues(before, after).map(identifyChange);
}
