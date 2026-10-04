import {
  childNode,
  childNodes,
  identifierName,
  isNode,
  type WorkflowNode,
} from './claude-workflow-ast.js';

/** The names a binding pattern introduces: `a`, `{ a, b: c }`, `[a, ...rest]`, `a = 1`. */
function patternNames(pattern: WorkflowNode | null | undefined): string[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'AssignmentPattern':
      return patternNames(childNode(pattern, 'left'));
    case 'RestElement':
      return patternNames(childNode(pattern, 'argument'));
    case 'ArrayPattern':
      return childNodes(pattern, 'elements').flatMap((element) => patternNames(element));
    case 'ObjectPattern':
      return childNodes(pattern, 'properties').flatMap((property) =>
        property?.type === 'RestElement'
          ? patternNames(property)
          : patternNames(property ? childNode(property, 'value') : undefined),
      );
    default:
      // An Identifier, the only other binding pattern.
      return [identifierName(pattern) ?? ''];
  }
}

/** Names a variable declaration (`const`, `let`, or `var`) introduces. */
function declarationNames(declaration: WorkflowNode | null | undefined): string[] {
  if (declaration?.type !== 'VariableDeclaration') return [];
  return childNodes(declaration, 'declarations').flatMap((declarator) =>
    patternNames(declarator ? childNode(declarator, 'id') : undefined),
  );
}

/** Names a statement list declares directly: variables, functions, and classes. */
function blockNames(statements: (WorkflowNode | null)[]): string[] {
  return statements.flatMap((statement) => {
    if (statement?.type === 'FunctionDeclaration' || statement?.type === 'ClassDeclaration') {
      return [identifierName(childNode(statement, 'id')) ?? ''];
    }
    return declarationNames(statement);
  });
}

function functionNames(node: WorkflowNode): string[] {
  const parameters = childNodes(node, 'params').flatMap((parameter) => patternNames(parameter));
  // A named function expression binds its own name inside itself.
  const ownName =
    node.type === 'FunctionExpression' ? [identifierName(childNode(node, 'id')) ?? ''] : [];
  return [...parameters, ...ownName];
}

const blockScope = (node: WorkflowNode) => blockNames(childNodes(node, 'body'));
const loopScope = (key: string) => (node: WorkflowNode) => declarationNames(childNode(node, key));

/** How each scope-creating node type binds names for everything inside it. */
const scopeRules: Record<string, (node: WorkflowNode) => string[]> = {
  Program: blockScope,
  BlockStatement: blockScope,
  StaticBlock: blockScope,
  FunctionDeclaration: functionNames,
  FunctionExpression: functionNames,
  ArrowFunctionExpression: functionNames,
  CatchClause: (node) => patternNames(childNode(node, 'param')),
  ForStatement: loopScope('init'),
  ForInStatement: loopScope('left'),
  ForOfStatement: loopScope('left'),
};

/** The names a node binds for everything inside it. */
function scopeNames(node: WorkflowNode): string[] {
  return scopeRules[node.type]?.(node) ?? [];
}

/**
 * Visit every call to one of `globals` that really reaches the workflow global:
 * a call whose name a parameter, local declaration, or catch or loop binding
 * shadows (`function run(agent) { agent() }`) invokes that binding instead, so
 * it is skipped. A top-level declaration shadows the global for the whole script.
 */
export function walkWorkflowGlobalCalls(
  program: WorkflowNode,
  globals: ReadonlySet<string>,
  visit: (call: WorkflowNode, name: string) => void,
): void {
  const walk = (node: WorkflowNode, shadowed: ReadonlySet<string>): void => {
    const names = scopeNames(node).filter((name) => globals.has(name));
    const inScope = names.length > 0 ? new Set([...shadowed, ...names]) : shadowed;

    if (node.type === 'CallExpression') {
      const name = identifierName(childNode(node, 'callee'));
      if (name !== undefined && globals.has(name) && !inScope.has(name)) visit(node, name);
    }
    for (const value of Object.values(node)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (isNode(item)) walk(item, inScope);
      }
    }
  };
  walk(program, new Set());
}
