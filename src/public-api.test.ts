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
 * importing everything, because some modules (the `bin.ts` entry point) run on
 * import.
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
        'isAgentFrontmatter',
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
        'isClaudeWorkflowJournalRecord',
        'isCodexHookInput',
        'isCodexHookInputFor',
        'isCodexHookOutputFor',
        'isCodexHookSettings',
        'isCodexMcpServer',
        'isCodexSessionRecord',
        'isCodexSessionRecordFor',
        'isCodexSkills',
        'isCodexTools',
        'isDefaultsSource',
        'isHooksSource',
        'isMcpSource',
        'isOpenaiConfiguration',
        'isSkillFrontmatter',
      ].toSorted(),
    );
  });
});
