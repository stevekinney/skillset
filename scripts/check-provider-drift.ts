import { parseArgs } from 'node:util';

import { z } from 'zod';

import { claudeHookEventNames } from '../src/claude-hook-shared.js';
import { codexHookEventNames } from '../src/codex-hook-payloads.js';
import { claudeHookSettingsSchema, codexHookSettingsSchema } from '../src/hook-schema.js';
import {
  artifactReader,
  baseline,
  codexHookBaseline,
  corpora,
  inventory,
  resolveTarget,
  type Artifact,
} from './provider-artifacts.js';
import {
  identifyChange,
  identifyContractChanges,
  normalizeSchema,
} from './provider-contract-diff.js';
import { countNeedsWork, formatFindings, formatTriageSummary } from './provider-drift-report.js';
import { countTriage, triageFindings } from './provider-drift-triage.js';

import { reviewedChanges, type ReviewedChange } from './provider-reviewed-changes.js';

const codexEvents = z.object({
  definitions: z.object({ HooksToml: z.object({ properties: z.record(z.string(), z.unknown()) }) }),
});
const sdkHookEvents = z.tuple([
  z.object({
    declaration: z.object({
      typeAnnotation: z.object({
        type: z.literal('TSUnionType'),
        types: z
          .array(
            z.object({
              literal: z.object({ value: z.string() }),
            }),
          )
          .min(1),
      }),
    }),
  }),
]);

function normalize(artifact: Artifact, data: unknown): unknown {
  return artifact.format === 'json' ? normalizeSchema(data) : data;
}

async function compareArtifacts(
  corpus: (typeof corpora)[number],
  before: Artifact[],
  after: Artifact[],
  read: ReturnType<typeof artifactReader>,
) {
  const left = new Map(before.map((artifact) => [artifact.name, artifact]));
  const right = new Map(after.map((artifact) => [artifact.name, artifact]));
  async function readNormalized(artifact?: Artifact): Promise<unknown> {
    return artifact && normalize(artifact, await read(artifact));
  }
  return Promise.all(
    [...new Set([...left.keys(), ...right.keys()])].toSorted().map(async (name) => {
      const previous = left.get(name);
      const current = right.get(name);
      const [previousData, currentData] = await Promise.all([
        readNormalized(previous),
        readNormalized(current),
      ]);
      const differences =
        previous && current
          ? identifyContractChanges(previousData, currentData)
          : [
              identifyChange({
                kind: previous ? 'removed' : 'added',
                path: '/',
                before: previousData,
                after: currentData,
              }),
            ];
      const reviews = reviewedChanges[corpus]?.[name] ?? {};
      const sinceReview = await changesSinceReview(current, currentData, reviews, read);
      const { changes, reviewed } = partitionReviewedChanges(differences, reviews, sinceReview);
      return {
        name,
        beforeUrl: previous?.url,
        afterUrl: current?.url,
        changes: triageFindings(corpus, name, changes),
        reviewed: triageFindings(corpus, name, reviewed, true),
      };
    }),
  );
}

async function changesSinceReview(
  current: Artifact | undefined,
  currentData: unknown,
  reviews: Record<string, ReviewedChange>,
  read: ReturnType<typeof artifactReader>,
) {
  if (!current) return [];
  const urls = new Set(Object.values(reviews).map(({ referenceUrl }) => referenceUrl));
  urls.delete(current.url);
  const differences = await Promise.all(
    [...urls].map(async (url) => {
      const reference = { ...current, url };
      return identifyContractChanges(
        normalize(reference, await read(reference)),
        currentData,
      ).filter(({ path }) => reviews[path]?.referenceUrl === url);
    }),
  );
  return differences.flat();
}

/** Match review records by exact path and fingerprint within one artifact. */
export function partitionReviewedChanges(
  differences: ReturnType<typeof identifyContractChanges>,
  reviews: Record<string, { fingerprint: string; reason: string }>,
  sinceReview: ReturnType<typeof identifyContractChanges> = [],
) {
  const changes: typeof differences = [];
  const reviewed: ((typeof differences)[number] & { reason: string })[] = [];
  for (const difference of differences) {
    const review = reviews[difference.path];
    if (review?.fingerprint === difference.fingerprint) {
      reviewed.push({ ...difference, reason: review.reason });
    } else {
      changes.push(difference);
    }
  }
  // A reversion can disappear from the original baseline diff entirely.
  const paths = new Set(differences.map(({ path }) => path));
  changes.push(
    ...sinceReview.filter(({ path }) => Object.hasOwn(reviews, path) && !paths.has(path)),
  );
  return { changes, reviewed };
}

function hookCoverage(
  upstream: string[],
  configuration: Iterable<string>,
  payloads: Iterable<string>,
) {
  const configured = new Set(configuration);
  const parsed = new Set(payloads);
  return {
    missingFromConfiguration: upstream.filter((name) => !configured.has(name)).toSorted(),
    missingFromPayloads: upstream.filter((name) => !parsed.has(name)).toSorted(),
  };
}

function argumentsForComparison() {
  return parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      'codex-tag': { type: 'string' },
      'claude-tag': { type: 'string' },
      'claude-sdk-version': { type: 'string' },
      'settings-commit': { type: 'string' },
    },
  }).values;
}

function usage() {
  console.log(`Usage: bun run scripts/check-provider-drift.ts [--all | --json]
       [--codex-tag rust-vX.Y.Z] [--claude-tag vX.Y.Z]
       [--claude-sdk-version X.Y.Z] [--settings-commit SHA]

Compare published provider artifacts against the pins in scripts/provider-artifacts.ts.
Findings include a triage category, reason, and action.
Use --all to list every finding still listed in the terminal, grouped by triage category.
Use --json for every finding, including its fingerprint, counts by category, and needsWork totals.
Targets default to the latest stable releases, SDK version, and SchemaStore commit.
Exit 0 means the comparison completed, even if drift was found. Exit 1 means it failed.`);
}

async function compare(target: typeof baseline) {
  const [previous, current] = await Promise.all([
    inventory(baseline, codexHookBaseline),
    inventory(target),
  ]);
  const read = artifactReader();
  const comparison = await Promise.all(
    corpora.map(async (name) => ({
      name,
      baselineOverride: name === 'Codex hook payloads' ? codexHookBaseline : undefined,
      artifacts: await compareArtifacts(
        name,
        previous.get(name) ?? [],
        current.get(name) ?? [],
        read,
      ),
    })),
  );

  const config = current.get(corpora[0])?.[0];
  const sdk = current.get(corpora[4])?.[0];
  if (!config || !sdk) throw new Error('Missing hook event inventory');
  const { definitions } = codexEvents.parse(await read(config));
  const sdkDeclarations = z.record(z.string(), z.unknown()).parse(await read(sdk));
  const [sdkHookEvent] = sdkHookEvents.parse(sdkDeclarations['HookEvent']);
  const coverage = {
    codex: hookCoverage(
      Object.keys(definitions.HooksToml.properties).filter((name) => name !== 'state'),
      Object.keys(codexHookSettingsSchema.shape),
      codexHookEventNames,
    ),
    claudeSdk: hookCoverage(
      sdkHookEvent.declaration.typeAnnotation.types.map(({ literal }) => literal.value),
      claudeHookSettingsSchema.keyType.options,
      claudeHookEventNames,
    ),
  };
  const artifacts = comparison.flatMap((corpus) => corpus.artifacts);
  const triage = {
    open: countTriage(artifacts.flatMap((artifact) => artifact.changes)),
    reviewed: countTriage(artifacts.flatMap((artifact) => artifact.reviewed)),
  };
  const needsWork = countNeedsWork(
    artifacts.flatMap((artifact) => artifact.changes),
    coverage,
  );
  return { baseline, target, comparison, coverage, triage, needsWork };
}

function printSummary(
  { target, comparison, coverage, triage, needsWork }: Awaited<ReturnType<typeof compare>>,
  showAll: boolean,
) {
  console.log(formatTriageSummary(triage, needsWork, showAll).join('\n').trimStart());
  console.log();
  for (const key of ['codex', 'claude', 'claudeSdk', 'schemaStore'] as const) {
    console.log(`${key}: ${baseline[key]} → ${target[key]}`);
  }
  for (const { name, artifacts, baselineOverride } of comparison) {
    const changes = artifacts.flatMap((artifact) =>
      artifact.changes.map((change) => ({
        ...change,
        artifact: artifact.name,
      })),
    );
    const findings = formatFindings(changes, showAll);
    if (findings.length === 0) continue;
    console.log(`\n${name}${baselineOverride ? ` (baseline ${baselineOverride})` : ''}`);
    console.log(findings.join('\n'));
  }
  console.log(
    '\nUse --all for the full scope table and reference findings, or --json for structured output.',
  );
  if (!showAll && needsWork.hookCoverageGaps === 0) return;
  console.log(
    '\nHook event parity affecting Skillset formats (Claude comparison uses SDK callbacks)',
  );
  for (const [provider, gaps] of Object.entries(coverage)) {
    console.log(
      `  ${provider} missing from Skillset configuration: ${gaps.missingFromConfiguration.join(', ') || 'none'}`,
    );
    console.log(
      `  ${provider} missing from Skillset payloads: ${gaps.missingFromPayloads.join(', ') || 'none'}`,
    );
  }
}

async function main() {
  const values = argumentsForComparison();
  if (values.help) {
    usage();
    return;
  }
  const report = await compare(await resolveTarget(values));
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printSummary(report, values.all ?? false);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
