import {
  triageCategories,
  triageLabels,
  type countTriage,
  type FindingAction,
  type triageFindings,
} from './provider-drift-triage.js';

const actionLabels: Record<FindingAction, string> = {
  'review-skillset': 'Review Skillset impact',
  'verify-scope': 'Verify scope',
  'reference-only': 'Reference only',
  reconciled: 'Recorded as reconciled',
};

type Finding = { triage: ReturnType<typeof triageFindings>[number]['triage'] };
type HookCoverage = Record<
  string,
  { missingFromConfiguration: string[]; missingFromPayloads: string[] }
>;

/** Count follow-up findings and missing hook configuration or payload entries. */
export function countNeedsWork(findings: Finding[], coverage: HookCoverage) {
  const counts = { reviewSkillset: 0, verifyScope: 0, hookCoverageGaps: 0 };
  for (const { triage } of findings) {
    if (triage.action === 'review-skillset') counts.reviewSkillset++;
    if (triage.action === 'verify-scope') counts.verifyScope++;
  }
  for (const gaps of Object.values(coverage)) {
    counts.hookCoverageGaps +=
      gaps.missingFromConfiguration.length + gaps.missingFromPayloads.length;
  }
  return counts;
}

/** Lead with follow-up and reconciliation. Include the scope table in the detailed report. */
export function formatTriageSummary(
  triage: { open: ReturnType<typeof countTriage>; reviewed: ReturnType<typeof countTriage> },
  { reviewSkillset, verifyScope, hookCoverageGaps }: ReturnType<typeof countNeedsWork>,
  showAll: boolean,
) {
  const work = reviewSkillset + verifyScope + hookCoverageGaps;
  const referenceOnly =
    Object.values(triage.open).reduce((total, count) => total + count, 0) -
    reviewSkillset -
    verifyScope;
  const reconciled = Object.values(triage.reviewed).reduce((total, count) => total + count, 0);
  const summary = [
    work
      ? `\nNeeds work: ${reviewSkillset} to review for Skillset impact, ${verifyScope} to verify for scope, ${hookCoverageGaps} hook coverage gaps`
      : '\nNeeds work: none',
    `Reference only: ${referenceOnly.toLocaleString('en-US')}`,
    `Recorded as reconciled: ${reconciled.toLocaleString('en-US')}`,
  ];
  if (!showAll) return summary;
  return [
    ...summary,
    '',
    '| Category | Still listed | Recorded as reconciled |',
    '| --- | ---: | ---: |',
    ...triageCategories.map(
      (category) =>
        `| ${category === 'skillset-format' ? 'Overlaps a Skillset format' : triageLabels[category]} | ${triage.open[category]} | ${triage.reviewed[category]} |`,
    ),
  ];
}

/** Mark actions on listed findings and prioritize follow-up in the examples. */
export function formatFindings(
  changes: (Finding & { artifact: string; kind: string; path: string })[],
  showAll: boolean,
) {
  return triageCategories.flatMap((category) => {
    const findings = changes
      .filter(({ triage }) => triage.category === category)
      .toSorted(
        (left, right) =>
          Number(left.triage.action === 'reference-only') -
          Number(right.triage.action === 'reference-only'),
      );
    const visible = showAll
      ? findings
      : findings.filter(({ triage }) => triage.action !== 'reference-only');
    if (!showAll) return visible.flatMap(formatFinding);
    return [
      `  ${triageLabels[category]}: ${findings.length} still listed`,
      ...visible.flatMap(formatFinding),
    ];
  });
}

function formatFinding({
  kind,
  artifact,
  path,
  triage,
}: Finding & { artifact: string; kind: string; path: string }) {
  return [
    `    [${actionLabels[triage.action]}] ${kind} ${artifact}${path}`,
    `      ${triage.reason}`,
  ];
}
