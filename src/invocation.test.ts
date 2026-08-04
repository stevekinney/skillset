import { describe, expect, it } from 'bun:test';

import { parseInvocation, USAGE } from './invocation.js';

function invocation(argv: string[]) {
  const parsed = parseInvocation(argv);
  if ('usageError' in parsed) throw new Error(`unexpected usage error: ${parsed.usageError}`);

  return parsed;
}

function usageError(argv: string[]): string {
  const parsed = parseInvocation(argv);
  if (!('usageError' in parsed)) throw new Error('expected a usage error');

  return parsed.usageError;
}

describe('parseInvocation', () => {
  it('defaults to sync with both targets at user scope', () => {
    expect(invocation([])).toEqual({
      command: 'sync',
      dryRun: false,
      prune: false,
      force: false,
      json: false,
      checkTargets: false,
      scope: 'user',
      targets: ['claude', 'codex'],
    });
  });

  it('parses sync flags', () => {
    const parsed = invocation([
      'sync',
      '--dry-run',
      '--prune',
      '--force',
      '--target',
      'codex',
      '--kind',
      'mcp',
    ]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.prune).toBe(true);
    expect(parsed.force).toBe(true);
    expect(parsed.targets).toEqual(['codex']);
    expect(parsed.kind).toBe('mcp');
  });

  it('parses every command shape', () => {
    expect(invocation(['doctor', '--json']).json).toBe(true);
    expect(invocation(['list']).command).toBe('list');
    expect(invocation(['show', 'demo']).name).toBe('demo');
    expect(invocation(['new', 'skill', 'demo'])).toMatchObject({
      sourceKind: 'skill',
      name: 'demo',
    });
    expect(invocation(['remove', 'agent', 'rev'])).toMatchObject({
      sourceKind: 'agent',
      name: 'rev',
    });
    expect(invocation(['get', 'skill', 'demo'])).toMatchObject({
      sourceKind: 'skill',
      name: 'demo',
    });
    expect(invocation(['get', 'skill', 'demo', 'model']).fieldPath).toBe('model');
    expect(invocation(['set', 'skill', 'demo', 'model', 'sonnet'])).toMatchObject({
      fieldPath: 'model',
      value: 'sonnet',
    });
  });

  it('parses scope, from, targets, and import shapes', () => {
    expect(invocation(['sync', '--scope', 'project']).scope).toBe('project');
    expect(invocation(['doctor', '--targets']).checkTargets).toBe(true);
    expect(invocation(['import', 'skill', 'legacy'])).toMatchObject({
      importKind: 'skill',
      name: 'legacy',
    });
    expect(invocation(['import', 'agent', 'rev', '--from', 'codex'])).toMatchObject({
      importKind: 'agent',
      from: 'codex',
    });
    expect(invocation(['import', 'instructions']).importKind).toBe('instructions');
    expect(invocation(['sync', '--kind', 'hooks']).kind).toBe('hooks');
  });

  it('reports usage errors', () => {
    expect(usageError(['--bogus'])).toContain('--bogus');
    expect(usageError(['deploy'])).toContain('unknown command');
    expect(usageError(['--target', 'cursor'])).toContain('--target expects');
    expect(usageError(['--kind', 'everything'])).toContain('--kind expects');
    expect(usageError(['show'])).toContain('show expects');
    expect(usageError(['new', 'skill'])).toContain('new expects');
    expect(usageError(['new', 'gadget', 'x'])).toContain('expected `skill` or `agent`');
    expect(usageError(['get', 'skill'])).toContain('get expects');
    expect(usageError(['get', 'widget', 'demo'])).toContain('expected `skill` or `agent`');
    expect(usageError(['set', 'skill', 'demo', 'model'])).toContain('set expects');
    expect(usageError(['set', 'widget', 'demo', 'model', 'x'])).toContain(
      'expected `skill` or `agent`',
    );
    expect(usageError(['--help'])).toBe('');
    expect(usageError(['--scope', 'galaxy'])).toContain('--scope expects');
    expect(usageError(['import', 'gadget', 'x'])).toContain('import expects');
    expect(usageError(['import', 'skill'])).toContain('import skill expects a <name>');
    expect(usageError(['import', 'instructions', 'extra'])).toContain('takes no <name>');
    expect(usageError(['import', 'skill', 'x', '--from', 'cursor'])).toContain('--from expects');
  });

  it('exports usage text', () => {
    expect(USAGE).toContain('skillset doctor');
    expect(USAGE).toContain('skillset set');
  });
});
