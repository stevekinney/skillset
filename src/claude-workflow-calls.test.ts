import { describe, expect, it } from 'bun:test';

import { checkClaudeWorkflowPhases, extractClaudeWorkflowCalls } from './claude-workflow-calls.js';

function calls(source: string) {
  const result = extractClaudeWorkflowCalls(source);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('extractClaudeWorkflowCalls', () => {
  it('evaluates literal agent options, resolving top-level constants', () => {
    const found = calls(
      [
        "const SCHEMA = { type: 'object', properties: { files: { type: 'array' } } }",
        "const result = await agent('List', { schema: SCHEMA, effort: 'low', label: 'list' })",
        'return result',
      ].join('\n'),
    );
    expect(found.agents).toEqual([
      {
        line: 2,
        column: 21,
        options: {
          schema: { type: 'object', properties: { files: { type: 'array' } } },
          effort: 'low',
          label: 'list',
        },
        unresolvedProperties: 0,
      },
    ]);
  });

  it('counts what it cannot evaluate instead of guessing', () => {
    const found = calls(
      [
        "await agent('a', { label: `file ${name}`, ...extra, [key]: 1, run() {}, effort: 'high' })",
        "await agent('b')",
        "await agent('c', options)",
      ].join('\n'),
    );
    expect(found.agents[0]).toMatchObject({
      options: { effort: 'high' },
      unresolvedProperties: 4,
    });
    expect(found.agentsWithoutLiteralOptions).toBe(2);
  });

  it('records phase titles from phase() calls and agent options', () => {
    const found = calls(
      [
        "phase('Scan')",
        'phase(title)',
        'phase()',
        "agent('x', { phase: 'Fix' })",
        'agent(`x`, { phase: dynamicPhase })',
        "agent('y', { label: 'no phase' })",
      ].join('\n'),
    );
    expect(found.phases.map(({ title, source }) => [title, source])).toEqual([
      ['Scan', 'phase-call'],
      [undefined, 'phase-call'],
      [undefined, 'phase-call'],
      ['Fix', 'agent-option'],
      [undefined, 'agent-option'],
    ]);
  });

  it('records workflow() references', () => {
    const found = calls(
      [
        "const CHILD = { scriptPath: '/tmp/child.js' }",
        "await workflow('saved-name', 1)",
        'await workflow(CHILD)',
        'await workflow(name)',
        'await workflow()',
      ].join('\n'),
    );
    expect(found.workflowReferences.map((entry) => entry.reference)).toEqual([
      'saved-name',
      { scriptPath: '/tmp/child.js' },
    ]);
    expect(found.workflowReferencesUnresolved).toBe(2);
  });

  it('ignores calls that are not to the script globals', () => {
    const found = calls('foo(1)\nobj.agent("x", {})\nphase');
    expect(found.agents).toEqual([]);
    expect(found.phases).toEqual([]);
  });

  it('reports a parse error with a position', () => {
    expect(extractClaudeWorkflowCalls('agent(')).toMatchObject({ ok: false, line: 1 });
  });
});

const use = (title: string | undefined) => ({
  line: 1,
  column: 0,
  title,
  source: 'phase-call' as const,
});

describe('checkClaudeWorkflowPhases', () => {
  it('reports unlisted, unused, and unverifiable titles', () => {
    const result = checkClaudeWorkflowPhases(
      [use('Scan'), use('Scan'), use('Typo'), use(undefined)],
      ['Scan', 'Fix'],
    );
    expect(result.unlisted.map((entry) => entry.title)).toEqual(['Typo']);
    expect(result.unused).toEqual(['Fix']);
    expect(result.unverifiable).toHaveLength(1);
  });

  it('is clean when titles match', () => {
    expect(checkClaudeWorkflowPhases([use('A')], ['A'])).toEqual({
      unlisted: [],
      unused: [],
      unverifiable: [],
    });
  });
});

describe('values held in top-level constants and quoted keys', () => {
  it('resolves phase titles and agent options stored in constants', () => {
    const result = extractClaudeWorkflowCalls(
      "const PHASE = 'Scan'\nconst OPTIONS = { effort: 'low', phase: 'Scan' }\nphase(PHASE)\nagent('x', OPTIONS)",
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.phases.map((phase) => phase.title)).toEqual(['Scan', 'Scan']);
    expect(result.agents.map((agent) => agent.options)).toEqual([{ effort: 'low', phase: 'Scan' }]);
    expect(result.agentsWithoutLiteralOptions).toBe(0);
  });

  it('skips a computed option key instead of failing the whole extraction', () => {
    const result = extractClaudeWorkflowCalls(
      "const key = 'label'\nagent('x', { [key]: 'y', phase: 'Scan' })",
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.phases.map((phase) => phase.title)).toEqual(['Scan']);
  });

  it('recognizes a quoted phase option key', () => {
    const result = extractClaudeWorkflowCalls("agent('x', { 'phase': 'Scan' })");
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.phases.map((phase) => phase.title)).toEqual(['Scan']);
  });
});
