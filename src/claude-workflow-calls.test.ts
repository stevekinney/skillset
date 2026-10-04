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

describe('option values a later property may replace', () => {
  it('keeps only values no later unresolved spread or computed key can overwrite', () => {
    const result = extractClaudeWorkflowCalls(
      "const extra = make()\nagent('x', { effort: 'bogus', ...extra, label: 'kept' })",
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents.map((agent) => agent.options)).toEqual([{ label: 'kept' }]);
    expect(result.agents.map((agent) => agent.unresolvedProperties)).toEqual([1]);
  });
});

describe('locally shadowed workflow globals', () => {
  it('ignores calls to a parameter, block binding, catch binding, or loop binding with a global name', () => {
    const result = extractClaudeWorkflowCalls(
      [
        "function run(agent) { agent('x', { effort: 'bogus' }) }",
        "const go = ({ phase }) => phase('Shadowed')",
        "{ const workflow = () => 1; workflow('not-a-reference') }",
        "try { run() } catch (agent) { agent('y') }",
        "for (const phase of []) { phase('Loop') }",
        "agent('real', { phase: 'Real' })",
      ].join('\n'),
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents.map((agent) => agent.options)).toEqual([{ phase: 'Real' }]);
    expect(result.phases.map((phase) => phase.title)).toEqual(['Real']);
    expect(result.workflowReferences).toEqual([]);
  });

  it('ignores every call when a top-level declaration shadows the global', () => {
    const result = extractClaudeWorkflowCalls(
      "const agent = () => 1\nagent('x', { effort: 'bogus' })",
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents).toEqual([]);
  });
});

describe('shadowing through every binding pattern', () => {
  it('treats default, rest, array, and object-rest bindings as shadowing', () => {
    const result = extractClaudeWorkflowCalls(
      [
        "function a(agent = 1) { agent('x', { effort: 'bogus' }) }",
        "function b(...agent) { agent('x', { effort: 'bogus' }) }",
        "function c([agent]) { agent('x', { effort: 'bogus' }) }",
        "function d({ ...agent }) { agent('x', { effort: 'bogus' }) }",
        "function e({ nested: [agent] }) { agent('x', { effort: 'bogus' }) }",
      ].join('\n'),
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents).toEqual([]);
  });
});

describe('constants the call site cannot rely on', () => {
  it('leaves a constant unresolved where a local binding shadows it', () => {
    const result = extractClaudeWorkflowCalls(
      "const PHASE = 'Scan'\nfunction run(PHASE) { phase(PHASE) }\nphase(PHASE)",
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.phases.map((phase) => phase.title)).toEqual([undefined, 'Scan']);
  });

  it('leaves an object constant unresolved when the script may mutate it', () => {
    const result = extractClaudeWorkflowCalls(
      [
        "const MUTATED = { effort: 'bogus' }",
        "MUTATED.effort = 'low'",
        "const ESCAPED = { effort: 'bogus' }",
        'prepare(ESCAPED)',
        "const STABLE = { effort: 'low' }",
        "agent('a', MUTATED)",
        "agent('b', ESCAPED)",
        "agent('c', STABLE)",
      ].join('\n'),
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents.map((agent) => agent.options)).toEqual([{ effort: 'low' }]);
    expect(result.agentsWithoutLiteralOptions).toBe(2);
  });

  it('reads constructor and prototype as ordinary option keys', () => {
    const result = extractClaudeWorkflowCalls("agent('x', { effort: 'bogus', constructor: 1 })");
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents.map((agent) => agent.options)).toEqual([
      { effort: 'bogus', constructor: 1 },
    ]);
  });
});

describe('every way a script can change an object constant', () => {
  it('treats updates, deletes, nested writes, Object.assign, and hand-offs as mutations', () => {
    const result = extractClaudeWorkflowCalls(
      [
        'const UPDATED = { stallMs: 1 }',
        'UPDATED.stallMs++',
        "const DELETED = { effort: 'low' }",
        'delete DELETED.effort',
        "const NESTED = { schema: { type: 'object', properties: {} } }",
        "NESTED.schema.properties.id = { type: 'string' }",
        "const ASSIGNED = { effort: 'low' }",
        "Object.assign(ASSIGNED, { effort: 'high' })",
        // Handed to another function, so conservatively unknown, even a harmless one.
        "const HANDED_OFF = { effort: 'low' }",
        'Object.freeze(HANDED_OFF)',
        "agent('a', UPDATED)",
        "agent('b', DELETED)",
        "agent('c', NESTED)",
        "agent('d', ASSIGNED)",
        "agent('e', HANDED_OFF)",
      ].join('\n'),
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agentsWithoutLiteralOptions).toBe(5);
  });
});

describe('var bindings hoisted to their function', () => {
  it('treats a var declared anywhere in a function as shadowing the global there', () => {
    const result = extractClaudeWorkflowCalls(
      [
        "function run() { if (false) { var agent } agent('x', { effort: 'bogus' }) }",
        "for (;;) { var phase; break } phase('Hoisted')",
        "agent('real', { phase: 'Real' })",
      ].join('\n'),
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agents.map((agent) => agent.options)).toEqual([{ phase: 'Real' }]);
    expect(result.phases.map((phase) => phase.title)).toEqual(['Real']);
  });
});

describe('object constants reached any other way', () => {
  it('stops resolving a constant once it is aliased or read through', () => {
    const result = extractClaudeWorkflowCalls(
      [
        "const ALIASED = { effort: 'bogus' }",
        'const ALIAS = ALIASED',
        "ALIAS.effort = 'low'",
        "const READ = { effort: 'low' }",
        'log(READ.effort)',
        "const SPREAD = { effort: 'low' }",
        "agent('a', ALIASED)",
        "agent('b', READ)",
        "agent('c', { ...SPREAD, label: 'kept' })",
        "agent('d', SPREAD)",
      ].join('\n'),
    );
    if (!result.ok) throw new Error('expected the script to parse');
    expect(result.agentsWithoutLiteralOptions).toBe(2);
    expect(result.agents.map((agent) => agent.options)).toEqual([
      { effort: 'low', label: 'kept' },
      { effort: 'low' },
    ]);
  });
});
