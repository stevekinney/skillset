import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { otherPayloads, responseItems } from './codex-session-fixtures.js';

// The checker runs as a separate process, so these tests exercise the real
// command end to end without pulling its modules into the coverage threshold.
const checker = join(import.meta.dir, '..', 'scripts', 'check-codex-session-schema.ts');
const timestamp = '2026-01-02T03:04:05.678Z';
const meta = JSON.stringify({
  timestamp,
  type: 'session_meta',
  payload: otherPayloads.session_meta,
});

async function runChecker(lines: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'codex-checker-'));
  try {
    await writeFile(join(root, 'rollout-test.jsonl'), `${lines.join('\n')}\n`);
    return runCheckerAt(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runCheckerAt(root: string) {
  const result = Bun.spawnSync(['bun', checker, '--jobs', '1', '--root', root], {
    stdin: 'ignore',
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

describe('check-codex-session-schema', () => {
  it('passes a clean rollout', () => {
    return runChecker([meta]).then(({ exitCode }) => expect(exitCode).toBe(0));
  });

  it('fails when malformed JSON appears before the last line', async () => {
    const { exitCode } = await runChecker(['{"timestamp": not json', meta]);
    expect(exitCode).not.toBe(0);
  });

  it('tolerates a partially written final line', async () => {
    const { exitCode } = await runChecker([meta, '{"timestamp": "2026-01-02T03:04:05']);
    expect(exitCode).toBe(0);
  });

  it('fails when a root cannot be read', () => {
    const { exitCode } = runCheckerAt(join(tmpdir(), 'codex-checker-does-not-exist'));
    expect(exitCode).not.toBe(0);
  });

  it('never prints message text, however short and repeated', async () => {
    const message = (text: string) =>
      JSON.stringify({
        timestamp,
        type: 'response_item',
        payload: { ...responseItems.message, content: [{ type: 'output_text', text }] },
      });
    const lines = [meta, ...Array.from({ length: 25 }, () => message('privatetoken'))];
    const { output } = await runChecker(lines);
    expect(output).not.toContain('privatetoken');
  });
});

describe('checker value counts', () => {
  it('count values named like Object.prototype members', () => {
    const statistics = join(
      import.meta.dir,
      '..',
      'scripts',
      'codex-session-check',
      'statistics.ts',
    );
    const script = `
      import { addToTally, createTally, mergeTallies } from ${JSON.stringify(statistics)};
      const tally = createTally();
      for (const value of ['constructor', 'toString', '__proto__', 'constructor']) addToTally(tally, value);
      const merged = createTally();
      mergeTallies(merged, JSON.parse(JSON.stringify(tally)));
      console.log(JSON.stringify({ own: Object.entries(tally.values), merged: Object.entries(merged.values) }));
    `;
    const result = Bun.spawnSync(['bun', '-e', script], { stdin: 'ignore' });
    const counts = JSON.parse(result.stdout.toString());
    const expected = [
      ['constructor', 2],
      ['toString', 1],
      ['__proto__', 1],
    ];
    expect(counts.own).toEqual(expected);
    expect(counts.merged).toEqual(expected);
  });
});
