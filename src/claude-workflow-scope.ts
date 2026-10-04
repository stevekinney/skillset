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

const functionTypes = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * `var` names declared anywhere inside `node`, not inside a nested function:
 * JavaScript hoists them to the enclosing function (or the program), so a `var`
 * in an `if` or loop still binds the name for the whole function.
 */
function hoistedVarNames(node: WorkflowNode): string[] {
  const names: string[] = [];
  forEachChild(node, (child) => {
    if (functionTypes.has(child.type)) return;
    if (child.type === 'VariableDeclaration' && child['kind'] === 'var') {
      names.push(...declarationNames(child));
    }
    names.push(...hoistedVarNames(child));
  });
  return names;
}

function functionNames(node: WorkflowNode): string[] {
  const body = childNode(node, 'body');
  const hoisted = body ? hoistedVarNames(body) : [];
  const parameters = [
    ...childNodes(node, 'params').flatMap((parameter) => patternNames(parameter)),
    ...hoisted,
  ];
  // A named function expression binds its own name inside itself.
  const ownName =
    node.type === 'FunctionExpression' ? [identifierName(childNode(node, 'id')) ?? ''] : [];
  return [...parameters, ...ownName];
}

const blockScope = (node: WorkflowNode) => blockNames(childNodes(node, 'body'));
const programScope = (node: WorkflowNode) => [...blockScope(node), ...hoistedVarNames(node)];
const loopScope = (key: string) => (node: WorkflowNode) => declarationNames(childNode(node, key));

/** How each scope-creating node type binds names for everything inside it. */
const scopeRules: Record<string, (node: WorkflowNode) => string[]> = {
  Program: programScope,
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
 *
 * `visit` also receives the names bound by enclosing function and block scopes
 * (not the program's own top level), so a caller resolving a top-level constant
 * at the call site can see that a local binding hides it.
 */
export function walkWorkflowGlobalCalls(
  program: WorkflowNode,
  globals: ReadonlySet<string>,
  visit: (call: WorkflowNode, name: string, localNames: ReadonlySet<string>) => void,
): void {
  const walk = (node: WorkflowNode, outer: Scopes): void => {
    const scopes = enterScope(node, outer, globals);
    const name =
      node.type === 'CallExpression' ? identifierName(childNode(node, 'callee')) : undefined;
    if (name !== undefined && globals.has(name) && !scopes.shadowedGlobals.has(name)) {
      visit(node, name, scopes.localNames);
    }
    forEachChild(node, (child) => walk(child, scopes));
  };
  walk(program, { shadowedGlobals: new Set(), localNames: new Set() });
}

type Scopes = { shadowedGlobals: ReadonlySet<string>; localNames: ReadonlySet<string> };

/**
 * The scopes inside `node`. Any binding of a global's name shadows it; only
 * bindings below the program's top level count as local names, since top-level
 * constants are what a resolver looks up.
 */
function enterScope(node: WorkflowNode, outer: Scopes, globals: ReadonlySet<string>): Scopes {
  const names = scopeNames(node);
  if (names.length === 0) return outer;
  const globalNames = names.filter((name) => globals.has(name));
  return {
    shadowedGlobals:
      globalNames.length > 0
        ? new Set([...outer.shadowedGlobals, ...globalNames])
        : outer.shadowedGlobals,
    localNames:
      node.type === 'Program' ? outer.localNames : new Set([...outer.localNames, ...names]),
  };
}

function forEachChild(node: WorkflowNode, visit: (child: WorkflowNode) => void): void {
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value]) if (isNode(item)) visit(item);
  }
}

/** Whether an identifier in this position names a binding rather than a value. */
function isNonReference(parent: WorkflowNode, key: string): boolean {
  if (parent.type === 'VariableDeclarator' && key === 'id') return true;
  if ((parent.type === 'Property' || parent.type === 'MemberExpression') && !parent['computed']) {
    return key === 'key' || key === 'property';
  }
  return false;
}

/**
 * Whether a child stays inside a literal handed to a safe callee: the values of
 * an object literal, the elements of an array literal, and a spread's argument
 * do; anything else (a call, a member access, an operator) leaves it.
 */
function staysInLiteral(node: WorkflowNode, key: string): boolean {
  if (node.type === 'ObjectExpression') return key === 'properties';
  if (node.type === 'Property') return key === 'value' && !node['computed'];
  if (node.type === 'ArrayExpression') return key === 'elements';
  return node.type === 'SpreadElement' && key === 'argument';
}

/**
 * Names referenced anywhere except inside a literal passed straight to one of
 * `safeCallees` (`agent('x', { schema: SCHEMA })`, or `...NAME`, which copies).
 * Any other reference (an alias, a property read or write, handing it to
 * another function) can let the script change the object a constant holds,
 * which a `const` binding doesn't prevent, so those constants can't be read
 * statically.
 */
/** Whether this identifier is a value reference that lets the object escape. */
function escapes(node: WorkflowNode, parent: WorkflowNode | undefined, key: string): boolean {
  if (node.type !== 'Identifier' || !parent || isNonReference(parent, key)) return false;
  return !(parent.type === 'CallExpression' && key === 'callee');
}

/** Whether the children under `key` sit inside a literal handed to a safe callee. */
function childInSafeLiteral(
  node: WorkflowNode,
  key: string,
  inSafeLiteral: boolean,
  safeCallees: ReadonlySet<string>,
): boolean {
  if (node.type === 'CallExpression' && key === 'arguments') {
    return safeCallees.has(identifierName(childNode(node, 'callee')) ?? '');
  }
  return inSafeLiteral && staysInLiteral(node, key);
}

export function escapingNames(
  program: WorkflowNode,
  safeCallees: ReadonlySet<string>,
): Set<string> {
  const escaping = new Set<string>();
  const walk = (
    node: WorkflowNode,
    parent: WorkflowNode | undefined,
    key: string,
    inSafeLiteral: boolean,
  ): void => {
    if (!inSafeLiteral && escapes(node, parent, key)) escaping.add(identifierName(node) ?? '');
    for (const [childKey, value] of Object.entries(node)) {
      const childSafe = childInSafeLiteral(node, childKey, inSafeLiteral, safeCallees);
      for (const item of Array.isArray(value) ? value : [value]) {
        if (isNode(item)) walk(item, node, childKey, childSafe);
      }
    }
  };
  walk(program, undefined, '', false);
  return escaping;
}
