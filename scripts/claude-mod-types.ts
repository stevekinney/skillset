import { parseArgs } from 'node:util';

import { claudeModDeclarationUrl } from './provider-artifacts.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('Usage: bun run scripts/claude-mod-types.ts <vX.Y.Z> > claude-code.d.ts');
    return;
  }
  const [tag] = positionals;
  if (!tag || positionals.length !== 1)
    throw new Error('Pass one stable Claude Code tag, such as v2.1.330');
  const url = claudeModDeclarationUrl(tag);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const declarations = await response.text();
  if (!/^declare module ['"]claude-code['"] \{/mu.test(declarations)) {
    throw new Error(`Missing the claude-code module declaration in ${url}`);
  }
  await Bun.write(Bun.stdout, declarations);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
