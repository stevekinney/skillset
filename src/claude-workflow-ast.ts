import { parse } from 'acorn';

import { claudeWorkflowReservedMetaKeys } from './claude-workflow-meta.js';

/**
 * Parsing and literal evaluation for Claude Code workflow scripts, built on the
 * same parser (acorn) and options the runtime uses, so a script that parses
 * here parses there.
 */

/** A syntax tree node. Read its fields through the accessors below. */
export type WorkflowNode = {
  type: string;
  start: number;
  end: number;
  loc: { start: { line: number; column: number } };
  [key: string]: unknown;
};

export type WorkflowParseResult =
  | { ok: true; program: WorkflowNode }
  | { ok: false; message: string; line?: number; column?: number };

function isNode(value: unknown): value is WorkflowNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

/** The child node under `key`, if there is one. */
export function childNode(node: WorkflowNode, key: string): WorkflowNode | undefined {
  const value = node[key];
  return isNode(value) ? value : undefined;
}

/** The child nodes under `key`. A hole in an array (`[1, , 2]`) is `null`. */
export function childNodes(node: WorkflowNode, key: string): Array<WorkflowNode | null> {
  const value = node[key];
  return Array.isArray(value) ? value.map((item) => (isNode(item) ? item : null)) : [];
}

/** The string under `key`, if there is one. */
export function stringField(node: WorkflowNode, key: string): string | undefined {
  const value = node[key];
  return typeof value === 'string' ? value : undefined;
}

/** The name of an `Identifier` node. */
export function identifierName(node: WorkflowNode | undefined): string | undefined {
  return node?.type === 'Identifier' ? stringField(node, 'name') : undefined;
}

/** Parse a workflow script as the runtime does: a module with top-level `await` and `return`. */
export function parseWorkflowProgram(source: string): WorkflowParseResult {
  try {
    const program: unknown = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    });
    return isNode(program) ? { ok: true, program } : { ok: false, message: 'no program' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const loc: unknown = error instanceof SyntaxError ? Reflect.get(error, 'loc') : undefined;
    if (typeof loc === 'object' && loc !== null && 'line' in loc && 'column' in loc)
      return { ok: false, message, line: Number(loc.line), column: Number(loc.column) };
    return { ok: false, message };
  }
}

/** Visit a node and every node beneath it, parents first. */
export function walkWorkflowNodes(node: WorkflowNode, visit: (node: WorkflowNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value])
      if (isNode(item)) walkWorkflowNodes(item, visit);
  }
}

/** The 1-based line and 0-based column a node starts at. */
export function nodeLocation(node: WorkflowNode): { line: number; column: number } {
  return { line: node.loc.start.line, column: node.loc.start.column };
}

/** Why a node is not a literal. */
export class WorkflowLiteralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowLiteralError';
  }
}

/** The name of a plain object-literal property, or why it has none. */
export function literalPropertyName(property: WorkflowNode): string {
  if (property['computed']) throw new WorkflowLiteralError('computed keys not allowed in meta');
  if (property['method'] || property['kind'] !== 'init')
    throw new WorkflowLiteralError('methods/accessors not allowed in meta');
  const key = childNode(property, 'key');
  const name = key?.type === 'Literal' ? String(key['value']) : identifierName(key ?? undefined);
  if (name === undefined)
    throw new WorkflowLiteralError(`unsupported key type in meta: ${key?.type}`);
  if (claudeWorkflowReservedMetaKeys.includes(name))
    throw new WorkflowLiteralError(`reserved key name not allowed in meta: ${name}`);
  return name;
}

/** Looks up an identifier's initializer, or returns `undefined` when it has none to offer. */
export type WorkflowIdentifierResolver = (name: string) => WorkflowNode | undefined;

function evaluateElements(
  node: WorkflowNode,
  resolve: WorkflowIdentifierResolver | undefined,
  depth: number,
): unknown[] {
  return childNodes(node, 'elements').map((element) => {
    if (element === null) throw new WorkflowLiteralError('sparse arrays not allowed');
    if (element.type === 'SpreadElement')
      throw new WorkflowLiteralError('spread not allowed in meta');
    return evaluateWorkflowLiteral(element, resolve, depth);
  });
}

function evaluateProperties(
  node: WorkflowNode,
  resolve: WorkflowIdentifierResolver | undefined,
  depth: number,
): Record<string, unknown> {
  const value: Record<string, unknown> = Object.create(null);
  for (const property of childNodes(node, 'properties')) {
    if (property?.type !== 'Property')
      throw new WorkflowLiteralError('only plain properties allowed in meta');
    const propertyValue = childNode(property, 'value');
    value[literalPropertyName(property)] = propertyValue
      ? evaluateWorkflowLiteral(propertyValue, resolve, depth)
      : undefined;
  }
  return value;
}

function evaluateTemplate(node: WorkflowNode): string {
  if (childNodes(node, 'expressions').length > 0)
    throw new WorkflowLiteralError('template interpolation not allowed in meta');
  return childNodes(node, 'quasis')
    .map((quasi) => {
      // A template element's `value` is `{ raw, cooked }`, not a node.
      const value = quasi?.['value'];
      const cooked =
        typeof value === 'object' && value !== null ? Reflect.get(value, 'cooked') : '';
      return typeof cooked === 'string' ? cooked : '';
    })
    .join('');
}

function evaluateNegativeNumber(node: WorkflowNode): number {
  const argument = childNode(node, 'argument');
  const value = argument?.type === 'Literal' ? argument['value'] : undefined;
  if (node['operator'] === '-' && typeof value === 'number') return -value;
  throw new WorkflowLiteralError('only negative-number unary allowed in meta');
}

/**
 * Evaluate a node that must be a pure literal, with the rules the runtime
 * applies to `meta`: strings, numbers, booleans, `null`, arrays without holes
 * or spreads, objects of plain properties, template literals without
 * interpolation, and negative numbers. An identifier is allowed only when a
 * `resolve` function supplies its initializer.
 *
 * Throws {@link WorkflowLiteralError}, naming the first thing that is not a literal.
 */
export function evaluateWorkflowLiteral(
  node: WorkflowNode,
  resolve?: WorkflowIdentifierResolver,
  depth = 0,
): unknown {
  const evaluators: Record<string, () => unknown> = {
    Literal: () => node['value'],
    ArrayExpression: () => evaluateElements(node, resolve, depth),
    ObjectExpression: () => evaluateProperties(node, resolve, depth),
    TemplateLiteral: () => evaluateTemplate(node),
    UnaryExpression: () => evaluateNegativeNumber(node),
    Identifier: () => {
      const initializer = depth < 32 ? resolve?.(identifierName(node) ?? '') : undefined;
      if (!initializer) throw new WorkflowLiteralError('non-literal node type in meta: Identifier');
      return evaluateWorkflowLiteral(initializer, resolve, depth + 1);
    },
  };
  const evaluate = Object.hasOwn(evaluators, node.type) ? evaluators[node.type] : undefined;
  if (!evaluate) throw new WorkflowLiteralError(`non-literal node type in meta: ${node.type}`);
  return evaluate();
}

/** Top-level `const NAME = <initializer>` declarations, by name. */
export function topLevelConstants(program: WorkflowNode): Map<string, WorkflowNode> {
  const constants = new Map<string, WorkflowNode>();
  for (const statement of childNodes(program, 'body')) {
    if (statement?.type !== 'VariableDeclaration' || statement['kind'] !== 'const') continue;
    for (const declaration of childNodes(statement, 'declarations')) {
      const name = declaration ? identifierName(childNode(declaration, 'id')) : undefined;
      const init = declaration ? childNode(declaration, 'init') : undefined;
      if (name !== undefined && init) constants.set(name, init);
    }
  }
  return constants;
}
