import {
  childNode,
  childNodes,
  evaluateWorkflowLiteral,
  identifierName,
  nodeLocation,
  parseWorkflowProgram,
  walkWorkflowNodes,
  type WorkflowNode,
} from './claude-workflow-ast.js';
import {
  claudeWorkflowMaximumScriptBytes,
  claudeWorkflowMetaSchema,
  type ClaudeWorkflowMeta,
} from './claude-workflow-meta.js';

/**
 * Static checks on a workflow script's source text. They apply the rules
 * Claude Code applies when it loads a script, using the same parser, so they
 * run without launching a workflow.
 */

export type ClaudeWorkflowMetaResult =
  | { ok: true; meta: ClaudeWorkflowMeta; scriptBody: string }
  | { ok: false; error: string; line?: number; column?: number };

/** The `meta` declarator of an `export const` statement, if that is what the statement is. */
function metaDeclarator(statement: WorkflowNode | null | undefined): WorkflowNode | undefined {
  const declaration =
    statement?.type === 'ExportNamedDeclaration' ? childNode(statement, 'declaration') : undefined;
  const declarators = declaration ? childNodes(declaration, 'declarations') : [];
  const [declarator] = declarators;
  const isMeta = declaration?.['kind'] === 'const' && declarators.length === 1;
  return isMeta && declarator && identifierName(childNode(declarator, 'id')) === 'meta'
    ? declarator
    : undefined;
}

/** The object literal of `export const meta = {...}`, if that is what the statement is. */
function metaInitializer(statement: WorkflowNode | null | undefined): WorkflowNode | undefined {
  const declarator = metaDeclarator(statement);
  const init = declarator ? childNode(declarator, 'init') : undefined;
  return init?.type === 'ObjectExpression' ? init : undefined;
}

/**
 * Read and validate the `export const meta = {...}` block of a workflow
 * script. It must be the first statement and a pure literal: no variables,
 * calls, spreads, computed keys, or template interpolation. Fails the way
 * Claude Code does, which drops such a script from `/` autocomplete.
 */
export function parseClaudeWorkflowMeta(source: string): ClaudeWorkflowMetaResult {
  if (new TextEncoder().encode(source).length > claudeWorkflowMaximumScriptBytes)
    return { ok: false, error: `Script exceeds ${claudeWorkflowMaximumScriptBytes} bytes` };

  const parsed = parseWorkflowProgram(source);
  if (!parsed.ok) {
    const { ok: _ok, message, ...position } = parsed;
    return { ok: false, error: `Script parse error: ${message}`, ...position };
  }

  const [first] = childNodes(parsed.program, 'body');
  const init = metaInitializer(first);
  if (!first || !init)
    return {
      ok: false,
      error: '`export const meta = { name, description, phases }` must be the FIRST statement',
      line: 1,
    };

  let literal: unknown;
  try {
    literal = evaluateWorkflowLiteral(init);
  } catch (error) {
    return {
      ok: false,
      error: `meta must be a pure literal: ${error instanceof Error ? error.message : String(error)}`,
      ...nodeLocation(init),
    };
  }

  const checked = claudeWorkflowMetaSchema.safeParse(literal);
  if (!checked.success) {
    const [issue] = checked.error.issues;
    return {
      ok: false,
      error: `meta.${issue?.path.join('.')}: ${issue?.message}`,
      ...nodeLocation(init),
    };
  }
  return { ok: true, meta: checked.data, scriptBody: source.slice(first.end).trimStart() };
}

/** A call the runtime makes throw, which would break a resumed run. */
export type ClaudeWorkflowForbiddenApi = {
  api: 'Date.now' | 'Math.random' | 'new Date()';
  line: number;
  column: number;
};

export type ClaudeWorkflowForbiddenApiResult =
  { ok: true; usages: ClaudeWorkflowForbiddenApi[] } | { ok: false; error: string };

function forbiddenApi(node: WorkflowNode): ClaudeWorkflowForbiddenApi['api'] | undefined {
  if (node.type === 'MemberExpression' && !node['computed']) {
    const api = `${identifierName(childNode(node, 'object'))}.${identifierName(childNode(node, 'property'))}`;
    return api === 'Date.now' || api === 'Math.random' ? api : undefined;
  }
  const isArgumentlessDate =
    node.type === 'NewExpression' &&
    identifierName(childNode(node, 'callee')) === 'Date' &&
    childNodes(node, 'arguments').length === 0;
  return isArgumentlessDate ? 'new Date()' : undefined;
}

/**
 * Find `Date.now`, `Math.random`, and `new Date()` with no arguments. Claude
 * Code makes all three throw inside a script, because they would make a resumed
 * run call different agents. Like the runtime, it flags only the plain spelling
 * (`Date.now`, not `Date['now']`).
 */
export function findClaudeWorkflowForbiddenApis(source: string): ClaudeWorkflowForbiddenApiResult {
  const parsed = parseWorkflowProgram(source);
  if (!parsed.ok) return { ok: false, error: parsed.message };

  const usages: ClaudeWorkflowForbiddenApi[] = [];
  walkWorkflowNodes(parsed.program, (node) => {
    const api = forbiddenApi(node);
    if (api) usages.push({ api, ...nodeLocation(node) });
  });
  return { ok: true, usages };
}
