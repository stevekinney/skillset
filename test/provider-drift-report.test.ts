import { expect, test } from 'bun:test';

import {
  countNeedsWork,
  formatFindings,
  formatTriageSummary,
} from '../scripts/provider-drift-report.js';
import { countTriage, triageFindings } from '../scripts/provider-drift-triage.js';

const artifact = 'codex_app_server_protocol.schemas.json';
const path = '/definitions/v2/AgentMessageDisplay';
const fingerprint = 'da702a07ef8a9c701ef86b3511b87c02540c6aa3283849f2b4bca6a43384ac10';
const findings = triageFindings('Codex App Server JSON-RPC', artifact, [
  { path, kind: 'added', fingerprint },
  { path, kind: 'changed', fingerprint: 'new-fingerprint' },
  { path: '/definitions/v2/Account', kind: 'added' },
  { path: '/definitions/v2/FutureContract', kind: 'added' },
]).map((finding) => ({ ...finding, artifact }));

test('puts follow-up ahead of reference-only drift and keeps every category visible', () => {
  const summary = formatFindings(findings, false);
  const review = `    [Review Skillset impact] changed ${artifact}${path}`;
  const reference = `    [Reference only] added ${artifact}${path}`;
  expect(summary).toContain(review);
  expect(summary).not.toContain(reference);
  expect(summary).toContain(`    [Verify scope] added ${artifact}/definitions/v2/FutureContract`);

  const detailed = formatFindings(findings, true);
  expect(detailed).toContain('  Upstream-only: 1 still listed');
  expect(detailed).toContain(reference);
  expect(detailed.indexOf(review)).toBeLessThan(detailed.indexOf(reference));
});

test('counts action separately from listed and reconciled findings', () => {
  const triage = { open: countTriage(findings), reviewed: countTriage([]) };
  const work = countNeedsWork(findings, {
    codex: { missingFromConfiguration: ['FutureHook'], missingFromPayloads: ['FutureHook'] },
  });
  expect(work).toEqual({ reviewSkillset: 1, verifyScope: 1, hookCoverageGaps: 2 });
  const summary = formatTriageSummary(triage, work, true);
  expect(summary[0]).toContain(
    '1 to review for Skillset impact, 1 to verify for scope, 2 hook coverage gaps',
  );
  expect(summary).toContain('| Category | Still listed | Recorded as reconciled |');
  const referenceOnly = findings.filter((finding) => finding.triage.action === 'reference-only');
  const noWork = { open: countTriage(referenceOnly), reviewed: countTriage([]) };
  expect(formatTriageSummary(noWork, countNeedsWork(referenceOnly, {}), false)).toEqual([
    '\nNeeds work: none',
    'Reference only: 2',
    'Recorded as reconciled: 0',
  ]);
});
