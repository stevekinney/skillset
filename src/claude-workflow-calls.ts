import {
  childNode,
  childNodes,
  evaluateWorkflowLiteral,
  identifierName,
  nodeLocation,
  parseWorkflowProgram,
  topLevelConstants,
  type WorkflowIdentifierResolver,
  type WorkflowNode,
} from './claude-workflow-ast.js';
import { escapingNames, walkWorkflowGlobalCalls } from './claude-workflow-scope.js';

/**
 * Finds the calls a workflow script makes to its globals, and evaluates each
 * argument that is written as a literal (or as a top-level `const` holding one).
 * What depends on a runtime value is counted as unresolved rather than guessed.
 */

export type ClaudeWorkflowCallSite = { line: number; column: number };

/** An `agent(prompt, options)` call whose options are an object literal. */
export type ClaudeWorkflowAgentCall = ClaudeWorkflowCallSite & {
  /** The options that could be evaluated. A property computed at runtime is left out. */
  options: Record<string, unknown>;
  /** How many properties (or spreads) of the options object could not be evaluated. */
  unresolvedProperties: number;
};

/** A `phase('title')` call, or the `phase` option of an `agent()` call. */
export type ClaudeWorkflowPhaseUse = ClaudeWorkflowCallSite & {
  /** `undefined` when the title is computed at runtime. */
  title: string | undefined;
  source: 'phase-call' | 'agent-option';
};

/** A `workflow(reference)` call whose reference is a literal. */
export type ClaudeWorkflowReferenceCall = ClaudeWorkflowCallSite & { reference: unknown };

export type ClaudeWorkflowCalls =
  | {
      ok: true;
      agents: ClaudeWorkflowAgentCall[];
      /** `agent()` calls whose options are not an object literal (absent, or a variable). */
      agentsWithoutLiteralOptions: number;
      /** First arguments of `workflow()`: a name, or a `{ scriptPath }` reference. */
      workflowReferences: ClaudeWorkflowReferenceCall[];
      workflowReferencesUnresolved: number;
      phases: ClaudeWorkflowPhaseUse[];
    }
  | { ok: false; error: string; line?: number; column?: number };

/** Evaluate an options object property by property, so one computed value costs only itself. */
function isComposite(node: WorkflowNode): boolean {
  return node.type === 'ObjectExpression' || node.type === 'ArrayExpression';
}

/** The object a spread copies, when it is a literal or a constant holding one. */
function spreadSource(
  property: WorkflowNode | null,
  resolve: WorkflowIdentifierResolver,
): WorkflowNode | undefined {
  if (property?.type !== 'SpreadElement') return undefined;
  const argument = childNode(property, 'argument');
  const source =
    argument?.type === 'Identifier' ? resolve(identifierName(argument) ?? '') : argument;
  return source?.type === 'ObjectExpression' ? source : undefined;
}

function evaluateOptions(node: WorkflowNode, resolve: WorkflowIdentifierResolver) {
  let options: Record<string, unknown> = {};
  let unresolvedProperties = 0;
  for (const property of childNodes(node, 'properties')) {
    const spread = spreadSource(property, resolve);
    if (spread) {
      // A known object spreads its own known keys over the ones before it.
      const copied = evaluateOptions(spread, resolve);
      options =
        copied.unresolvedProperties > 0 ? copied.options : { ...options, ...copied.options };
      unresolvedProperties += copied.unresolvedProperties;
      continue;
    }
    const value = property ? childNode(property, 'value') : undefined;
    const name = property?.type === 'Property' ? optionPropertyName(property) : undefined;
    if (name === undefined || !value) {
      // A spread or computed key can overwrite any key set before it, so those
      // values are no longer known; only later properties are final.
      options = {};
      unresolvedProperties += 1;
      continue;
    }
    try {
      options[name] = evaluateWorkflowLiteral(value, resolve);
    } catch {
      // A non-literal value leaves only its own key unknown.
      delete options[name];
      unresolvedProperties += 1;
    }
  }
  return { options, unresolvedProperties };
}

function literalOrUndefined(
  node: WorkflowNode | null | undefined,
  resolve?: WorkflowIdentifierResolver,
) {
  try {
    return node ? evaluateWorkflowLiteral(node, resolve) : undefined;
  } catch {
    return undefined;
  }
}

type Found = Extract<ClaudeWorkflowCalls, { ok: true }>;

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * An option property's literal name (identifier or quoted), or `undefined` for a
 * computed key, method, or accessor. Unlike `meta`, an options object has no
 * reserved names: `constructor` is an ordinary key there.
 */
function optionPropertyName(property: WorkflowNode): string | undefined {
  if (property['computed'] || property['method'] || property['kind'] !== 'init') return undefined;
  const key = childNode(property, 'key');
  return key?.type === 'Literal' ? String(key['value']) : identifierName(key);
}

function recordAgent(
  found: Found,
  call: WorkflowNode,
  options: WorkflowNode,
  resolve: WorkflowIdentifierResolver,
) {
  const evaluated = evaluateOptions(options, resolve);
  found.agents.push({ ...nodeLocation(call), ...evaluated });
  const phaseProperty = childNodes(options, 'properties').find(
    (property) => property?.type === 'Property' && optionPropertyName(property) === 'phase',
  );
  if (phaseProperty)
    found.phases.push({
      ...nodeLocation(phaseProperty),
      title: stringOrUndefined(evaluated.options['phase']),
      source: 'agent-option',
    });
}

/** An `agent()` options argument: a literal, or a top-level constant holding one. */
function resolvedOptions(
  argument: WorkflowNode | null | undefined,
  resolve: WorkflowIdentifierResolver,
): WorkflowNode | null | undefined {
  return argument?.type === 'Identifier' ? resolve(identifierName(argument) ?? '') : argument;
}

/** The script globals whose calls are extracted. */
const workflowCallGlobals: ReadonlySet<string> = new Set(['agent', 'phase', 'workflow']);

function recordCall(found: Found, call: WorkflowNode, resolve: WorkflowIdentifierResolver) {
  const name = identifierName(childNode(call, 'callee'));
  const [first, second] = childNodes(call, 'arguments');
  const options = resolvedOptions(second, resolve);
  if (name === 'agent' && options?.type === 'ObjectExpression') {
    recordAgent(found, call, options, resolve);
  } else if (name === 'agent') {
    found.agentsWithoutLiteralOptions += 1;
  } else if (name === 'phase') {
    found.phases.push({
      ...nodeLocation(call),
      title: stringOrUndefined(literalOrUndefined(first, resolve)),
      source: 'phase-call',
    });
  } else if (name === 'workflow') {
    const reference = literalOrUndefined(first, resolve);
    if (reference === undefined) found.workflowReferencesUnresolved += 1;
    else found.workflowReferences.push({ ...nodeLocation(call), reference });
  }
}

/** Find every `agent()`, `workflow()`, and `phase()` call in a workflow script. */
export function extractClaudeWorkflowCalls(source: string): ClaudeWorkflowCalls {
  const parsed = parseWorkflowProgram(source);
  if (!parsed.ok) {
    const { ok: _ok, message, ...position } = parsed;
    return { ok: false, error: message, ...position };
  }

  const constants = topLevelConstants(parsed.program);
  // An object or array constant is only knowable when nothing else can reach it.
  const escaping = escapingNames(parsed.program, workflowCallGlobals);
  const unknowable = new Set(
    [...constants]
      .filter(([name, init]) => escaping.has(name) && isComposite(init))
      .map(([name]) => name),
  );
  const found: Found = {
    ok: true,
    agents: [],
    agentsWithoutLiteralOptions: 0,
    workflowReferences: [],
    workflowReferencesUnresolved: 0,
    phases: [],
  };
  walkWorkflowGlobalCalls(parsed.program, workflowCallGlobals, (call, _name, localNames) => {
    // A top-level constant resolves only where no local binding hides it and the
    // script never changes the object it holds.
    const resolve: WorkflowIdentifierResolver = (name) =>
      localNames.has(name) || unknowable.has(name) ? undefined : constants.get(name);
    recordCall(found, call, resolve);
  });
  return found;
}

export type ClaudeWorkflowPhaseCheck = {
  /** Titles used by a `phase()` call or `agent({ phase })` that no `meta.phases` entry names. */
  unlisted: ClaudeWorkflowPhaseUse[];
  /** `meta.phases` titles that nothing uses. */
  unused: string[];
  /** Uses whose title is computed at runtime, so they cannot be checked. */
  unverifiable: ClaudeWorkflowPhaseUse[];
};

/**
 * Compare the phase titles a script uses with `meta.phases`. Claude Code
 * matches titles exactly and gives a title with no entry a progress group of its
 * own, so an unlisted title is a warning about a likely typo, not an error.
 */
export function checkClaudeWorkflowPhases(
  uses: readonly ClaudeWorkflowPhaseUse[],
  listedTitles: readonly string[],
): ClaudeWorkflowPhaseCheck {
  const used = new Set<string>();
  const unlisted: ClaudeWorkflowPhaseUse[] = [];
  const unverifiable: ClaudeWorkflowPhaseUse[] = [];
  for (const use of uses) {
    if (use.title === undefined) unverifiable.push(use);
    else {
      used.add(use.title);
      if (!listedTitles.includes(use.title)) unlisted.push(use);
    }
  }
  return { unlisted, unused: listedTitles.filter((title) => !used.has(title)), unverifiable };
}
