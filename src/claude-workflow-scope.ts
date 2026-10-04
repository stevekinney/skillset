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

/** The identifier at the root of a member chain: `options` in `options.schema.type`. */
function memberRoot(node: WorkflowNode | undefined): string | undefined {
  let current = node;
  while (current?.type === 'MemberExpression') current = childNode(current, 'object');
  return current?.type === 'Identifier' ? identifierName(current) : undefined;
}

const objectMutators = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);

/** Mutations through a member chain: `x.a = 1`, `x.a++`, `delete x.a`. */
const memberMutations: Record<string, (node: WorkflowNode) => WorkflowNode | undefined> = {
  AssignmentExpression: (node) => childNode(node, 'left'),
  UpdateExpression: (node) => childNode(node, 'argument'),
  UnaryExpression: (node) =>
    node['operator'] === 'delete' ? childNode(node, 'argument') : undefined,
};

function isObjectMutator(callee: WorkflowNode | undefined): boolean {
  return (
    callee?.type === 'MemberExpression' &&
    identifierName(childNode(callee, 'object')) === 'Object' &&
    objectMutators.has(identifierName(childNode(callee, 'property')) ?? '')
  );
}

/**
 * Names a call may mutate: `Object.assign(target, ...)` and friends mutate their
 * first argument, and any function other than `safeCallees` may mutate whatever
 * object it is handed.
 */
function callMutationTargets(node: WorkflowNode, safeCallees: ReadonlySet<string>): string[] {
  const callee = childNode(node, 'callee');
  if (safeCallees.has(identifierName(callee) ?? '')) return [];
  const passed = childNodes(node, 'arguments').map((argument) =>
    argument?.type === 'Identifier' ? (identifierName(argument) ?? '') : '',
  );
  return isObjectMutator(callee) ? passed.slice(0, 1) : passed;
}

/** The names a node may mutate through, if it is a mutation at all. */
function mutationTargets(node: WorkflowNode, safeCallees: ReadonlySet<string>): string[] {
  if (node.type === 'CallExpression') return callMutationTargets(node, safeCallees);
  const target = memberMutations[node.type]?.(node);
  return target ? [memberRoot(target) ?? ''] : [];
}

/**
 * Names whose object the script may change after binding it: a property
 * assignment, update, or `delete` through it (at any depth), an `Object.assign`
 * style call on it, or handing it to a function other than `safeCallees`. A
 * `const` freezes the binding, not the object, so these can't be read statically.
 */
export function possiblyMutatedNames(
  program: WorkflowNode,
  safeCallees: ReadonlySet<string>,
): Set<string> {
  const mutated = new Set<string>();
  const walk = (node: WorkflowNode): void => {
    for (const name of mutationTargets(node, safeCallees)) if (name !== '') mutated.add(name);
    forEachChild(node, walk);
  };
  walk(program);
  return mutated;
}
