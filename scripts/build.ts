import { $ } from 'bun';
import pkg from '../package.json' with { type: 'json' };

const entrypoints = ['./src/index.ts', './src/bin.ts'];
const external = Array.from(
  new Set([
    ...Object.keys(
      (pkg as Record<string, unknown> & { dependencies?: Record<string, string> }).dependencies ??
        {},
    ),
    ...Object.keys(
      (pkg as Record<string, unknown> & { peerDependencies?: Record<string, string> })
        .peerDependencies ?? {},
    ),
    ...Object.keys(
      (pkg as Record<string, unknown> & { optionalDependencies?: Record<string, string> })
        .optionalDependencies ?? {},
    ),
  ]),
);

await $`rm -rf dist`;

// The node and bun builds are independent (separate outdirs, no shared state),
// so run them concurrently rather than one after the other.
await Promise.all(
  (['node', 'bun'] as const).map((target) =>
    Bun.build({
      entrypoints,
      outdir: `./dist/${target}`,
      target,
      format: 'esm',
      naming: '[dir]/[name].js',
      sourcemap: 'linked',
      minify: false,
      external,
    }),
  ),
);

// npm resolves the `bin` entry with the system loader, which needs a shebang.
for (const target of ['node', 'bun'] as const) {
  const path = `dist/${target}/bin.js`;
  await Bun.write(path, `#!/usr/bin/env node\n${await Bun.file(path).text()}`);
  await $`chmod +x ${path}`;
}

await $`bun run tsc --declaration --emitDeclarationOnly --project tsconfig.build.json`;

console.log('Build complete.');
