import { renderReport } from './codex-session-check/report.js';
import {
  checkFile,
  defaultRolloutRoots,
  listRolloutFiles,
} from './codex-session-check/rollout-files.js';
import {
  createStatistics,
  isStatistics,
  mergeStatistics,
  type Statistics,
} from './codex-session-check/statistics.js';

/**
 * Streams every Codex session rollout on this machine through
 * `codexSessionRecordSchema` and reports what the schema gets wrong.
 *
 *   bun scripts/check-codex-session-schema.ts [--jobs N] [--stride K] [--root DIRECTORY]...
 *
 * The files are split across `--jobs` worker processes (default 8), each
 * streaming its share line by line, so memory stays flat however large a rollout
 * is. `--stride K` checks every Kth file, for quick iteration. The output holds
 * only types, field paths, counts, short enum-like values, and file and line
 * locations: never record content.
 *
 * Exit code 1 when any record fails to parse, real data carries a key the
 * schema does not name, or a literal rejects a value.
 */

interface Options {
  jobs: number;
  stride: number;
  roots: string[];
  /** Set only in a worker process: which share of the files to check. */
  shard: { index: number; count: number } | undefined;
}

const flagHandlers: Record<string, (options: Options, value: string) => void> = {
  '--jobs': (options, value) => void (options.jobs = Number(value)),
  '--stride': (options, value) => void (options.stride = Number(value)),
  '--root': (options, value) => void options.roots.push(value),
  '--shard': (options, value) => {
    const [index = 0, count = 1] = value.split('/').map(Number);
    options.shard = { index, count };
  },
};

function readOptions(argv: string[]): Options {
  const options: Options = { jobs: 8, stride: 1, roots: [], shard: undefined };
  for (let position = 0; position < argv.length; position += 2) {
    const handler = flagHandlers[argv[position] ?? ''];
    const value = argv[position + 1];
    if (!handler || value === undefined) throw new Error(`Unexpected argument: ${argv[position]}`);
    handler(options, value);
  }
  if (options.roots.length === 0) options.roots = defaultRolloutRoots();
  return options;
}

async function runShard(options: Options, index: number, count: number): Promise<Statistics> {
  const files = await listRolloutFiles(options.roots);
  const everyStride = files.filter((_, position) => position % options.stride === 0);
  const statistics = createStatistics();
  for (const file of everyStride.filter((_, position) => position % count === index)) {
    await checkFile(file, statistics);
  }
  return statistics;
}

async function runWorkers(options: Options): Promise<Statistics> {
  const rootArguments = options.roots.flatMap((root) => ['--root', root]);
  const workers = Array.from({ length: options.jobs }, (_, index) =>
    Bun.spawn(
      [
        process.execPath,
        import.meta.path,
        '--shard',
        `${index}/${options.jobs}`,
        '--stride',
        String(options.stride),
        ...rootArguments,
      ],
      { stdout: 'pipe', stderr: 'inherit' },
    ),
  );
  const total = createStatistics();
  for (const worker of workers) {
    const output = await new Response(worker.stdout).text();
    if ((await worker.exited) !== 0) throw new Error('A worker process failed.');
    const shard: unknown = JSON.parse(output);
    if (!isStatistics(shard)) throw new Error('A worker printed something other than statistics.');
    mergeStatistics(total, shard);
  }
  return total;
}

const options = readOptions(Bun.argv.slice(2));

if (options.shard) {
  console.log(JSON.stringify(await runShard(options, options.shard.index, options.shard.count)));
} else {
  const report = renderReport(await runWorkers(options));
  console.log(report.text);
  process.exitCode = report.failed ? 1 : 0;
}
