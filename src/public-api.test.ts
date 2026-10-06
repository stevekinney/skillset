import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import * as publicApi from './index.js';

/**
 * Schemas a module exports only so sibling modules can share them. They are
 * building blocks of a public schema, not a surface of their own, and their
 * generic names would be ambiguous in the package's public API.
 */
const INTERNAL_SCHEMAS = new Map<string, string[]>([
  [
    'claude-hook-shared.ts',
    [
      'backgroundTaskSchema',
      'compactTriggerSchema',
      'elicitationModeSchema',
      'mcpServerSchema',
      'recordSchema',
      'sessionCronSchema',
    ],
  ],
  ['codex-session-metadata.ts', ['originatorSchema', 'sessionSourceSchema', 'threadSourceSchema']],
  [
    'codex-session-response-items.ts',
    ['buildCodexResponseItemSchema', 'responsesWebSearchActionSchema'],
  ],
]);

/**
 * Whole modules of building blocks for the Codex session schema. They exist only
 * because the schema is split to stay under the lint's file-length cap; every
 * shape in them is reachable through `codexSessionRecordSchemas` and friends.
 */
const INTERNAL_MODULES = new Set([
  'codex-session-content.ts',
  'codex-session-shared.ts',
  'codex-session-state.ts',
  'codex-session-turn-item-parts.ts',
]);

const sourceDirectory = import.meta.dir;

/**
 * Source modules that export a schema. Selected by their text rather than by
 * importing every module.
 */
async function schemaModules(): Promise<string[]> {
  const files = await readdir(sourceDirectory);
  const sources = files.filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  const withSchemas: string[] = [];

  for (const file of sources) {
    const text = await Bun.file(join(sourceDirectory, file)).text();
    if (/^export const \w+Schemas?\b/m.test(text)) withSchemas.push(file);
  }

  return withSchemas.toSorted();
}

describe('public API', () => {
  it('exports every schema a module exports, except documented building blocks', async () => {
    const missing: string[] = [];

    for (const file of await schemaModules()) {
      if (INTERNAL_MODULES.has(file)) continue;
      const module: Record<string, unknown> = await import(join(sourceDirectory, file));
      const internal = INTERNAL_SCHEMAS.get(file) ?? [];

      for (const [name, value] of Object.entries(module)) {
        if (!/Schemas?$/.test(name) || internal.includes(name)) continue;
        if ((publicApi as Record<string, unknown>)[name] !== value)
          missing.push(`${file}: ${name}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('keeps the internal-schema allowlist accurate', async () => {
    for (const [file, names] of INTERNAL_SCHEMAS) {
      const module: Record<string, unknown> = await import(join(sourceDirectory, file));
      for (const name of names) {
        expect(module[name]).toBeDefined();
        expect((publicApi as Record<string, unknown>)[name]).toBeUndefined();
      }
    }
  });

  it('keeps every internal module out of the public API', async () => {
    for (const file of INTERNAL_MODULES) {
      const module: Record<string, unknown> = await import(join(sourceDirectory, file));
      const schemas = Object.keys(module).filter((name) => /Schemas?$/.test(name));
      expect(schemas.length).toBeGreaterThan(0);
      for (const name of schemas) {
        expect((publicApi as Record<string, unknown>)[name]).toBeUndefined();
      }
    }
  });

  it('exports a type guard for every public top-level schema', () => {
    const guards = Object.keys(publicApi).filter((name) => /^is[A-Z]/.test(name));
    expect(guards.toSorted()).toEqual(
      [
        'isClaudeAgentFrontmatter',
        'isClaudeAgentMcpServer',
        'isClaudeEffort',
        'isClaudeHookInput',
        'isClaudeHookInputFor',
        'isClaudeHookOutput',
        'isClaudeHookSettings',
        'isClaudeMcpServer',
        'isClaudeSessionRecord',
        'isClaudeSessionRecordFor',
        'isClaudeSettingsEffort',
        'isClaudeSkillFrontmatter',
        'isClaudeWorkflowAgentOptions',
        'isClaudeWorkflowBudget',
        'isClaudeWorkflowJournalRecord',
        'isClaudeWorkflowMeta',
        'isClaudeWorkflowOutputSchema',
        'isClaudeWorkflowReference',
        'isClaudeWorkflowRunRecord',
        'isClaudeWorkflowToolInput',
        'isClaudeWorkflowToolOutput',
        'isCodexAgent',
        'isCodexHookInput',
        'isCodexHookInputFor',
        'isCodexHookOutputFor',
        'isCodexHookSettings',
        'isCodexMcpServer',
        'isCodexSessionRecord',
        'isCodexSessionRecordFor',
        'isCodexSkillFrontmatter',
        'isCodexSkills',
        'isCodexTools',
        'isOpenaiConfiguration',
      ].toSorted(),
    );
  });

  it('exports an inferred type for every public schema', async () => {
    const indexText = await Bun.file(join(sourceDirectory, 'index.ts')).text();
    const missing = Object.keys(publicApi)
      .filter((name) => name.endsWith('Schema') && !name.startsWith('is'))
      .map((name) => `${name[0]!.toUpperCase()}${name.slice(1, -'Schema'.length)}`)
      .filter((typeName) => !new RegExp(`\\btype ${typeName}\\b`).test(indexText));

    expect(missing).toEqual([]);
  });

  it('documents every public export in the README', async () => {
    const readme = await Bun.file(join(sourceDirectory, '..', 'README.md')).text();
    const indexText = await Bun.file(join(sourceDirectory, 'index.ts')).text();
    const typeNames = [...indexText.matchAll(/\btype (\w+)/g)].map((match) => match[1]!);
    const mentioned = (name: string) => new RegExp(`\\b${name}\\b`).test(readme);
    // A type is documented by its own name or by the schema it is inferred from.
    const documentedType = (name: string) =>
      mentioned(name) || mentioned(`${name[0]!.toLowerCase()}${name.slice(1)}Schema`);
    const undocumented = [
      ...Object.keys(publicApi).filter((name) => !mentioned(name)),
      ...typeNames.filter((name) => !documentedType(name)),
    ];

    expect(undocumented).toEqual([]);
  });

  describe('subpath entry points', () => {
    const entries = ['hooks', 'sessions', 'workflows'] as const;

    for (const name of entries) {
      it(`./${name} re-exports the root's own values and nothing else`, async () => {
        const entry: Record<string, unknown> = await import(`./entry-${name}.js`);
        const names = Object.keys(entry);

        expect(names.length).toBeGreaterThan(0);
        for (const exported of names) {
          expect((publicApi as Record<string, unknown>)[exported]).toBe(entry[exported]);
        }
      });
    }

    it('covers every hook, session, and workflow schema in some entry point', async () => {
      const hooks = Object.keys(await import('./entry-hooks.js'));
      const sessions = Object.keys(await import('./entry-sessions.js'));
      const workflows = Object.keys(await import('./entry-workflows.js'));
      const covered = new Set([...hooks, ...sessions, ...workflows]);
      // `*HookSettings` validate the `hooks:` config block, which is a source format, not a payload.
      const domain = /^(is|parse|safeParse)?(claude|codex|Claude|Codex)(Hook|Session|Workflow)/;
      const missing = Object.keys(publicApi).filter(
        (name) => domain.test(name) && !/HookSettings/.test(name) && !covered.has(name),
      );

      expect(missing).toEqual([]);
    });

    it('declares each entry point in package.json exports and typesVersions', async () => {
      const manifest: {
        exports: Record<string, Record<string, string>>;
        typesVersions: Record<string, Record<string, string[]>>;
      } = JSON.parse(await Bun.file(join(sourceDirectory, '..', 'package.json')).text());

      for (const name of entries) {
        expect(manifest.exports[`./${name}`]).toEqual({
          types: `./dist/entry-${name}.d.ts`,
          bun: `./dist/bun/entry-${name}.js`,
          import: `./dist/node/entry-${name}.js`,
          default: `./dist/node/entry-${name}.js`,
        });
        expect(manifest.typesVersions['*']?.[name]).toEqual([`./dist/entry-${name}.d.ts`]);
      }
    });
  });
});
