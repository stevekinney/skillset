import { unlink } from 'node:fs/promises';
import { $ } from 'bun';

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
} finally {
  await unlink(filename).catch(() => {
    // Nothing to clean up if packing itself failed.
  });
}
