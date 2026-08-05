import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { $ } from 'bun';

import pkg from '../package.json' with { type: 'json' };

/**
 * Type-check the packed tarball the way a consumer would.
 *
 * `publint` and `@arethetypeswrong/cli` verify that every export condition
 * *resolves*. They do not verify that the declarations it resolves to are
 * usable. A build that emits a `.d.ts` re-exporting from itself passes both
 * cleanly while every consumer gets "Circular definition of import alias" and
 * no public type materializes at all.
 *
 * So this packs the package, installs the tarball into a throwaway directory,
 * and runs `tsc` over a fixture that imports each typed export subpath with
 * `skipLibCheck: false` — which forces the whole declaration graph to be
 * checked rather than trusted.
 *
 * This costs a pack, an install, and a compile on every `validate`. That is
 * deliberate: it is the only check here that fails when the published types
 * are broken.
 */

type ExportCondition = Record<string, unknown> | string;

type Manifest = {
  readonly name: string;
  readonly types?: string;
  readonly exports?: Record<string, ExportCondition>;
  readonly peerDependencies?: Record<string, string>;
};

const manifest = pkg as Manifest;

/** Return the export subpaths that advertise TypeScript declarations. */
function typedSubpaths(): string[] {
  const entries = manifest.exports;
  if (entries === undefined) {
    return manifest.types === undefined ? [] : ['.'];
  }

  const subpaths: string[] = [];
  for (const [subpath, condition] of Object.entries(entries)) {
    if (subpath.endsWith('.json')) continue;

    const typed =
      typeof condition === 'string' || (typeof condition === 'object' && 'types' in condition);
    if (typed) subpaths.push(subpath);
  }

  return subpaths;
}

/**
 * Build a fixture that pulls every typed subpath into the program.
 *
 * Importing each subpath is enough: it puts the shipped declarations into the
 * program, and `skipLibCheck: false` then checks them rather than trusting
 * them. Nothing needs to be referenced, because the defect being guarded
 * against lives in the declaration files themselves.
 */
function fixture(specifiers: readonly string[]): string {
  const lines = specifiers.map(
    (specifier, index) => `import type * as Entry${index} from '${specifier}';`,
  );

  return `${lines.join('\n')}\nexport {};\n`;
}

const subpaths = typedSubpaths();
if (subpaths.length === 0) {
  console.log('No typed export subpaths to verify.');
  process.exit(0);
}

const specifiers = subpaths.map((subpath) =>
  subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
);

const packed = await $`npm pack --silent`.text();
const tarball = packed.trim().split('\n').at(-1);
if (tarball === undefined || tarball.length === 0) {
  throw new Error('npm pack did not report a tarball name.');
}

const tarballPath = join(process.cwd(), tarball);
const directory = await mkdtemp(join(tmpdir(), 'verify-package-types-'));

try {
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'consumer', type: 'module', private: true }, undefined, 2)}\n`,
  );

  // `skipLibCheck: false` is the entire point: it checks the shipped
  // declarations instead of assuming they are well-formed. `nodenext` matches
  // how a real ESM consumer resolves the exports map.
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          lib: ['es2022', 'esnext.disposable', 'dom'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          // Named explicitly rather than relying on automatic `@types`
          // inclusion, which TypeScript 7 does not apply here. Without it the
          // `NodeJS` namespace is missing and every declaration that mentions
          // it fails for a reason unrelated to the package.
          types: ['node'],
        },
        files: ['check.ts'],
      },
      undefined,
      2,
    )}\n`,
  );

  await writeFile(join(directory, 'check.ts'), fixture(specifiers));

  // npm, not bun: this simulates an npm consumer installing the published
  // artifact, and avoids any workspace or link resolution leaking in.
  //
  // `@types/node` stands in for the ambient types a Node consumer already has.
  // Without it, any declaration mentioning the `NodeJS` namespace fails here
  // for a reason that has nothing to do with the package being correct.
  const peers = Object.keys(manifest.peerDependencies ?? {});
  await $`npm install --silent --no-audit --no-fund ${tarballPath} typescript @types/node ${peers}`.cwd(
    directory,
  );

  await $`npx tsc --project tsconfig.json`.cwd(directory);

  // Types being correct does not mean the JavaScript loads. A bundler can emit
  // an entry that is nothing but `export { … }` with no imports and no
  // definitions — which happened here, because `sideEffects: false` let Bun
  // tree-shake the body of a pure re-export barrel. The declarations stayed
  // perfect, `publint`, `attw`, and `tsc` all passed, and every consumer got
  // `SyntaxError: Export 'X' is not defined in module` on import. So actually
  // import each entry, in Node, from the installed tarball.
  for (const specifier of specifiers) {
    await $`node --input-type=module -e ${`
      const loaded = await import(${JSON.stringify(specifier)});
      const names = Object.keys(loaded);
      if (names.length === 0) {
        throw new Error(${JSON.stringify(`${specifier} imported but exported nothing`)});
      }
      for (const [name, value] of Object.entries(loaded)) {
        if (value === undefined) {
          throw new Error(${JSON.stringify(specifier)} + ' exports ' + name + ' as undefined');
        }
      }
    `}`.cwd(directory);
  }

  console.log(`Package types and runtime imports verified for ${specifiers.join(', ')}.`);
} finally {
  await rm(tarballPath, { force: true });
  await rm(directory, { recursive: true, force: true });
}
