import { unlink } from 'node:fs/promises';
import { $ } from 'bun';
import packageDefinition from '../package.json' with { type: 'json' };

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

  const bin = packageDefinition as { bin?: Record<string, string> };
  for (const [binaryName, binaryPath] of Object.entries(bin.bin ?? {})) {
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
