import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Read at runtime rather than importing the JSON: the `bin` field is optional,
// so a typed import would not compile in a package that has none.
const definition: unknown = await Bun.file(join(import.meta.dir, '..', 'package.json')).json();
const binaries = isRecord(definition) && isRecord(definition['bin']) ? definition['bin'] : {};

// `attw --pack` shells out to a hardcoded `npm pack` internally. That is
// unreliable when this script itself runs nested inside an active `npm
// publish` (e.g. via the `prepublishOnly` lifecycle script) — a second npm
// process invoked from within the first silently fails to produce a
// tarball, and attw then reports a confusing `ENOENT` instead of the real
// error. Packing ourselves with `bun pm pack` (which has no such issue) and
// handing attw the resulting file directly sidesteps the bug entirely.
await $`publint`;

const filename = 'skillset-package-check.tgz';
await $`bun pm pack --quiet --filename ${filename}`;

try {
  await $`bun x attw ${filename} --ignore-rules cjs-resolves-to-esm`;

  // publint and attw both check the exports map; neither opens the tarball to
  // confirm the `bin` targets are actually inside it. A binary left out of
  // `files`, or missing its shebang, publishes green and then fails the first
  // time somebody runs `npx <package>`.
  const contents = await $`tar -tzf ${filename}`.text();
  const entries = new Set(contents.split('\n').map((line) => line.trim()));

  for (const [binaryName, binaryPath] of Object.entries(binaries)) {
    if (typeof binaryPath !== 'string') continue;

    const packedPath = `package/${binaryPath.replace(/^\.\//, '')}`;

    if (!entries.has(packedPath)) {
      throw new Error(
        `bin["${binaryName}"] points at ${binaryPath}, which is not in the tarball. ` +
          'Check the `files` array and that the build ran.',
      );
    }

    const packedBinary = await $`tar -xzOf ${filename} ${packedPath}`.text();
    const firstLine = packedBinary.split('\n')[0] ?? '';
    if (!firstLine.startsWith('#!')) {
      throw new Error(
        `bin["${binaryName}"] (${binaryPath}) has no shebang, so running it directly fails. ` +
          'The build should prepend one.',
      );
    }
  }
} finally {
  await unlink(filename).catch(() => {
    // Nothing to clean up if packing itself failed.
  });
}
