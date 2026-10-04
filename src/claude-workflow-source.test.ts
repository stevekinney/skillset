import { describe, expect, it } from 'bun:test';

import {
  childNode,
  childNodes,
  evaluateWorkflowLiteral,
  identifierName,
  parseWorkflowProgram,
  stringField,
  topLevelConstants,
  walkWorkflowNodes,
  type WorkflowNode,
} from './claude-workflow-ast.js';
import { claudeWorkflowMaximumScriptBytes } from './claude-workflow-meta.js';
import {
  findClaudeWorkflowForbiddenApis,
  parseClaudeWorkflowMeta,
} from './claude-workflow-source.js';

const body = "\nphase('Scan')\nreturn 1\n";

function metaError(literal: string): string {
  const result = parseClaudeWorkflowMeta(`export const meta = ${literal}${body}`);
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

describe('parseClaudeWorkflowMeta', () => {
  it('reads a pure-literal meta block and returns the body', () => {
    const result = parseClaudeWorkflowMeta(
      `// header\nexport const meta = {\n  name: 'audit', // trailing\n  'description': \`Audit routes\`,\n  title: "T",\n  phases: [{ title: 'Scan', detail: 'x' }, { title: 'Fix', model: 'sonnet' }],\n}\n${body}`,
    );
    expect(result).toMatchObject({
      ok: true,
      meta: {
        name: 'audit',
        description: 'Audit routes',
        title: 'T',
        phases: [
          { title: 'Scan', detail: 'x' },
          { title: 'Fix', model: 'sonnet' },
        ],
      },
    });
    expect(result.ok && result.scriptBody).toBe("phase('Scan')\nreturn 1\n");
  });

  it('allows top-level return and await in the body, as the runtime does', () => {
    const source = `export const meta = { name: 'a', description: 'b' }\nconst x = await agent('hi')\nreturn x\n`;
    expect(parseClaudeWorkflowMeta(source).ok).toBe(true);
  });

  it('accepts negative numbers, booleans, and null as literal values', () => {
    const result = parseClaudeWorkflowMeta(
      "export const meta = { name: 'a', description: 'b', offset: -1, flag: true, none: null }",
    );
    expect(result).toMatchObject({ ok: true, meta: { offset: -1, flag: true, none: null } });
  });

  it('rejects everything that is not a pure literal', () => {
    expect(metaError("{ name: 'a', description: `b ${1}` }")).toContain(
      'template interpolation not allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', ...rest }")).toContain(
      'only plain properties allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', phases: [...rest] }")).toContain(
      'spread not allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', phases: [,] }")).toContain(
      'sparse arrays not allowed',
    );
    expect(metaError("{ name: 'a', description: 'b', [key]: 1 }")).toContain(
      'computed keys not allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', run() {} }")).toContain(
      'methods/accessors not allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', get x() { return 1 } }")).toContain(
      'methods/accessors not allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', 1: 2, __proto__: {} }")).toContain(
      'reserved key name not allowed in meta: __proto__',
    );
    expect(metaError("{ name: 'a', description: 'b', constructor: 1 }")).toContain(
      'reserved key name not allowed in meta: constructor',
    );
    expect(metaError("{ name: 'a', description: 'b', n: +1 }")).toContain(
      'only negative-number unary allowed in meta',
    );
    expect(metaError("{ name: 'a', description: 'b', n: -x }")).toContain(
      'only negative-number unary allowed in meta',
    );
    expect(metaError("{ name: NAME, description: 'b' }")).toContain(
      'non-literal node type in meta: Identifier',
    );
    expect(metaError("{ name: 'a', description: ['x'].join() }")).toContain(
      'non-literal node type in meta: CallExpression',
    );
  });

  it('reports the location of an impure literal', () => {
    const result = parseClaudeWorkflowMeta(
      "\n\nexport const meta = { name: NAME, description: 'b' }",
    );
    expect(result).toMatchObject({ ok: false, line: 3 });
  });

  it('requires meta to be the first, only const declaration named meta', () => {
    const first = '`export const meta = { name, description, phases }` must be the FIRST statement';
    const meta = "{ name: 'a', description: 'b' }";
    for (const source of [
      `const x = 1\nexport const meta = ${meta}`,
      `export const metadata = ${meta}`,
      `export let meta = ${meta}`,
      `export const meta = ${meta}, other = 1`,
      `export const meta = 'text'`,
      `export function meta() {}`,
      `const meta = ${meta}`,
      '',
    ]) {
      expect(parseClaudeWorkflowMeta(source)).toMatchObject({ ok: false, error: first });
    }
  });

  it('requires a name and a description', () => {
    expect(metaError("{ description: 'b' }")).toContain('meta.name');
    expect(metaError("{ name: 'a', description: '' }")).toContain('meta.description');
  });

  it('reports syntax errors with a position, and TypeScript as one', () => {
    const result = parseClaudeWorkflowMeta(
      "export const meta = { name: 'a', description: 'b' }\nconst x: string = 'y'",
    );
    expect(result).toMatchObject({ ok: false, line: 2 });
    expect(!result.ok && result.error).toStartWith('Script parse error:');
  });

  it('rejects a script over the size cap', () => {
    const big = `export const meta = { name: 'a', description: 'b' }\n// ${'x'.repeat(claudeWorkflowMaximumScriptBytes)}`;
    expect(parseClaudeWorkflowMeta(big)).toMatchObject({
      ok: false,
      error: `Script exceeds ${claudeWorkflowMaximumScriptBytes} bytes`,
    });
  });
});

describe('findClaudeWorkflowForbiddenApis', () => {
  it('finds Date.now, Math.random, and an argless new Date', () => {
    const result = findClaudeWorkflowForbiddenApis(
      "const a = Date.now()\nconst b = Math.random()\nconst c = new Date()\nconst d = new Date('2026-01-01')\nconst e = Date['now']()\nconst f = Math.floor(1)\nconst g = this.x.y\nconst h = a[0]",
    );
    expect(result).toEqual({
      ok: true,
      usages: [
        { api: 'Date.now', line: 1, column: 10 },
        { api: 'Math.random', line: 2, column: 10 },
        { api: 'new Date()', line: 3, column: 10 },
      ],
    });
  });

  it('finds nothing in a clean script and reports a parse error', () => {
    expect(findClaudeWorkflowForbiddenApis('return args.date')).toEqual({ ok: true, usages: [] });
    expect(findClaudeWorkflowForbiddenApis('const = ;')).toMatchObject({ ok: false });
  });
});

function program(source: string): WorkflowNode {
  const parsed = parseWorkflowProgram(source);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.program;
}

describe('workflow AST helpers', () => {
  it('reads children, strings, and identifiers defensively', () => {
    const root = program('const a = 1');
    expect(childNode(root, 'body')).toBeUndefined();
    expect(childNodes(root, 'type')).toEqual([]);
    expect(childNodes(root, 'body')).toHaveLength(1);
    expect(stringField(root, 'sourceType')).toBe('module');
    expect(stringField(root, 'start')).toBeUndefined();
    expect(identifierName(undefined)).toBeUndefined();
    expect(identifierName(root)).toBeUndefined();
  });

  it('walks every node', () => {
    const types: string[] = [];
    walkWorkflowNodes(program('f(1, [2])'), (node) => types.push(node.type));
    expect(types).toEqual([
      'Program',
      'ExpressionStatement',
      'CallExpression',
      'Identifier',
      'Literal',
      'ArrayExpression',
      'Literal',
    ]);
  });

  it('resolves top-level consts, with a depth limit for cycles', () => {
    const root = program(
      'const A = { x: 1 }\nlet B = 2\nconst { C } = d\nconst E = A\nconst X = X',
    );
    const constants = topLevelConstants(root);
    expect([...constants.keys()]).toEqual(['A', 'E', 'X']);
    const resolve = (name: string) => constants.get(name);
    const reference = (name: string): WorkflowNode => {
      const statement = childNodes(program(name), 'body')[0];
      const expression = statement && childNode(statement, 'expression');
      if (!expression) throw new Error('no expression');
      return expression;
    };
    expect(evaluateWorkflowLiteral(reference('E'), resolve)).toEqual({ x: 1 });
    expect(() => evaluateWorkflowLiteral(reference('X'), resolve)).toThrow('non-literal');
    expect(() => evaluateWorkflowLiteral(reference('A'))).toThrow('non-literal');
  });
});
