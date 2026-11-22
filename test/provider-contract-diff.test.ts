import { describe, expect, test } from 'bun:test';

import { claudeModDeclarationUrl } from '../scripts/provider-artifacts.js';
import { partitionReviewedChanges } from '../scripts/check-provider-drift.js';

import {
  declarationContract,
  diffContracts,
  identifyContractChanges,
  normalizeSchema,
} from '../scripts/provider-contract-diff.js';
import { classifyFinding, countTriage, triageFindings } from '../scripts/provider-drift-triage.js';

function methodVariant(method: string) {
  return { properties: { method: { const: method } } };
}

function classifyAppServerFinding(path: string) {
  return classifyFinding(
    'Codex App Server JSON-RPC',
    'codex_app_server_protocol.schemas.json',
    path,
  ).category;
}

describe('provider drift triage', () => {
  const artifact = 'config.schema.json';
  const corpus = 'Codex configuration';
  const toolPath = '/definitions/ToolsToml/properties/client_search_provider';

  test('matches a scoped pointer and descendants without conflating adjacent fields', () => {
    expect(classifyFinding(corpus, artifact, toolPath).category).toBe('skillset-format');
    expect(classifyFinding(corpus, artifact, `${toolPath}/type`).category).toBe('skillset-format');
    expect(classifyFinding(corpus, artifact, `${toolPath}_other`).category).toBe(
      'needs-verification',
    );
    expect(classifyFinding(corpus, 'other.schema.json', toolPath).category).toBe(
      'needs-verification',
    );
    expect(
      classifyFinding(corpus, artifact, '/definitions/ConfigProfile/properties/features').category,
    ).toBe('needs-verification');
  });

  test('keeps overlapping rollout shapes distinct from RPC-only contracts', () => {
    expect(
      classifyAppServerFinding(
        '/definitions/v2/ThreadItem/oneOf/type=agentMessage/properties/moderation',
      ),
    ).toBe('skillset-format');
    expect(classifyAppServerFinding('/definitions/ClientRequest/oneOf/method=thread~1read')).toBe(
      'upstream-only',
    );
    expect(
      classifyAppServerFinding(
        '/definitions/v2/ThreadItem/oneOf/type=imageGeneration/properties/inputImages',
      ),
    ).toBe('skillset-format');
    expect(
      classifyAppServerFinding('/definitions/v2/ThreadUsage/properties/nativeUsageUsdMicros'),
    ).toBe('upstream-only');
    expect(
      classifyAppServerFinding('/definitions/v2/ThreadRealtimeItem/properties/observedAtMs'),
    ).toBe('upstream-only');
    expect(classifyAppServerFinding('/definitions/v2/FutureContract')).toBe('needs-verification');
  });

  test('scopes Codex feature flags and distinguishes preset preservation from TUI behavior', () => {
    const category = (path: string) => classifyFinding(corpus, artifact, path).category;
    expect(category('/properties/features/properties/mcp_connection_sharing')).toBe(
      'upstream-only',
    );
    expect(
      category('/definitions/ConfigProfile/properties/features/properties/ultrafast_mode'),
    ).toBe('upstream-only');
    expect(category('/properties/features/properties/shell_tool')).toBe('skillset-format');
    expect(category('/properties/features/properties/future_feature')).toBe('needs-verification');
    expect(category('/definitions/Tui/properties/presets')).toBe('skillset-format');
    expect(category('/definitions/Tui/properties/keymap')).toBe('upstream-only');
    expect(category('/definitions/PluginsConfigToml')).toBe('upstream-only');
  });

  test('labels every open and reviewed finding while preserving review status and evidence', () => {
    const hook = identifyContractChanges({}, { properties: { enabled: true } })[0];
    if (!hook) throw new Error('Expected the fixture to produce a difference');
    const changed = { ...hook, path: toolPath };
    const other = { ...hook, path: '/definitions/Tui/properties/theme' };
    const unknown = { ...hook, path: '/definitions/ConfigProfile' };
    const reason = 'Verified by fixture';
    const partition = partitionReviewedChanges([changed, other, unknown], {
      [toolPath]: { fingerprint: changed.fingerprint, reason },
    });
    const open = triageFindings(corpus, artifact, partition.changes);
    const reviewed = triageFindings(corpus, artifact, partition.reviewed, true);
    expect(open.map(({ triage: _triage, ...finding }) => finding)).toEqual([other, unknown]);
    expect(reviewed).toMatchObject([
      { ...changed, reason, triage: { category: 'skillset-format', action: 'reconciled' } },
    ]);
    expect(countTriage(open)).toEqual({
      'skillset-format': 0,
      'upstream-only': 1,
      'needs-verification': 1,
    });
    expect(countTriage(reviewed)).toEqual({
      'skillset-format': 1,
      'upstream-only': 0,
      'needs-verification': 0,
    });
  });
});

describe('provider contract drift', () => {
  test('keeps unrelated drift open inside an artifact with an exact review', () => {
    const previous = { definitions: {} };
    const schema = { type: 'object', properties: { command: { type: 'string' } } };
    const current = { definitions: { ModelHook: schema, Other: { type: 'string' } } };
    const [modelHook, other] = identifyContractChanges(previous, current);
    if (!modelHook || !other) throw new Error('Fixture must produce both changes');
    const reason = 'Verified hook discovery and dispatch';
    const records = { [modelHook.path]: { fingerprint: modelHook.fingerprint, reason } };
    expect(partitionReviewedChanges(identifyContractChanges(previous, current), records)).toEqual({
      changes: [other],
      reviewed: [{ ...modelHook, reason }],
    });
    expect(
      partitionReviewedChanges(
        identifyContractChanges(previous, {
          definitions: { ModelHook: { properties: schema.properties, type: 'object' } },
        }),
        records,
      ).changes,
    ).toEqual([]);
    const changed = identifyContractChanges(previous, {
      definitions: { ModelHook: { ...schema, required: ['command'] } },
    });
    expect(partitionReviewedChanges(changed, records)).toEqual({ changes: changed, reviewed: [] });
    const reversed = identifyContractChanges(current, previous);
    expect(partitionReviewedChanges(reversed, records)).toEqual({
      changes: reversed,
      reviewed: [],
    });
    expect(partitionReviewedChanges([], records, reversed)).toEqual({
      changes: reversed.filter(({ path }) => path === modelHook.path),
      reviewed: [],
    });
  });

  test('uses the same pinned Claude Mod declaration for authoring and comparison', () => {
    expect(claudeModDeclarationUrl('v2.1.330')).toBe(
      'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
    );
    expect(() => claudeModDeclarationUrl('latest')).toThrow('Expected a stable Claude Code tag');
  });

  test('classifies audited Mod symbols without assuming future symbols have the same scope', () => {
    for (const [name, category] of [
      ['SessionAppendResult', 'skillset-format'],
      ['SessionAppendInput', 'upstream-only'],
      ['SkillFrontmatter', 'upstream-only'],
      ['SessionPolicyExample', 'needs-verification'],
    ] as const) {
      expect(
        classifyFinding('Claude Code Mods', 'claude-code.d.ts', `/module claude-code/${name}`)
          .category,
      ).toBe(category);
    }
  });

  test('detects named fields, enum members, requiredness, and changes to literal defaults', () => {
    const before = normalizeSchema({
      description: 'old docs',
      properties: {
        description: { type: 'string' },
        mode: { enum: ['b', 'a'], default: { description: 'old' } },
      },
      required: ['mode'],
    });
    const after = normalizeSchema({
      description: 'new docs',
      properties: {
        description: { type: 'number' },
        mode: { enum: ['a', 'b', 'c'], default: { description: 'new' } },
      },
      required: ['description', 'mode'],
    });

    expect(diffContracts(before, after)).toEqual([
      { kind: 'changed', path: '/properties/description/type', before: 'string', after: 'number' },
      {
        kind: 'changed',
        path: '/properties/mode/default/description',
        before: 'old',
        after: 'new',
      },
      { kind: 'added', path: '/properties/mode/enum/c', after: true },
      { kind: 'added', path: '/required/description', after: true },
    ]);
  });

  test('aligns named JSON Schema variants when a branch is inserted or reordered', () => {
    const before = normalizeSchema({ oneOf: [methodVariant('read'), methodVariant('write')] });
    const after = normalizeSchema({
      oneOf: [methodVariant('write'), methodVariant('add/item'), methodVariant('read')],
    });
    expect(diffContracts(before, after)).toEqual([
      { kind: 'added', path: '/oneOf/method=add~1item' },
    ]);
  });

  test('matches interface and object members by name in the presence of index signatures', async () => {
    const before = await declarationContract(`
      export interface Settings {
        [key: string]: unknown;
        enabled?: boolean;
        nested: { [key: string]: unknown; name: string };
      }
    `);
    const after = await declarationContract(`
      export interface Settings {
        nested: { name: string; extra?: boolean; [key: string]: unknown };
        [key: string]: boolean | object | undefined;
        enabled?: boolean;
      }
    `);

    expect(diffContracts(before, after).map(({ path }) => path)).toEqual([
      '/Settings/0/declaration/body/body/[index:TSStringKeyword]/typeAnnotation/typeAnnotation/type',
      '/Settings/0/declaration/body/body/[index:TSStringKeyword]/typeAnnotation/typeAnnotation/types',
      '/Settings/0/declaration/body/body/nested/typeAnnotation/typeAnnotation/members/extra',
    ]);
  });

  test('matches import and export bindings and standalone variables by identity', async () => {
    const before = await declarationContract(`
      import type { First as Local, Second } from 'dependency';
      import type { Other } from 'other';
      export type { First as Public, Second } from 'dependency';
      export declare const one: number;
      export declare const two: string;
    `);
    const after = await declarationContract(`
      export declare const two: string;
      import type { Other } from 'other';
      import type { Third, Second, Renamed as Local } from 'dependency';
      export type { Third, Renamed as Public } from 'dependency';
      export declare const one: number;
    `);

    const paths = diffContracts(before, after).map(({ path }) => path);
    expect(paths).toEqual([
      '/export from dependency/0/specifiers/Public/local/name',
      '/export from dependency/0/specifiers/Second',
      '/export from dependency/0/specifiers/Third',
      '/import from dependency/0/specifiers/Local/imported/name',
      '/import from dependency/0/specifiers/Third',
    ]);
  });

  test('ignores declaration formatting and module splits while naming added fields', async () => {
    const before = await declarationContract(`
      declare module "provider" {
        export interface First { field: number }
        export interface Second { count?: number; name: string }
      }
    `);
    const after = await declarationContract(`
      // Comment to shift source offsets
      declare module 'provider' { export interface Second { name: string; count: number; extra?: string } }
      declare module 'provider' { export interface First { field: number; } }
    `);

    expect(diffContracts(before, after)).toEqual([
      {
        kind: 'changed',
        path: '/module provider/Second/0/declaration/body/body/count/optional',
        before: true,
        after: false,
      },
      { kind: 'added', path: '/module provider/Second/0/declaration/body/body/extra' },
    ]);
  });
});
