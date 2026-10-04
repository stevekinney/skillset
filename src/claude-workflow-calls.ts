import {
  childNode,
  childNodes,
  evaluateWorkflowLiteral,
  identifierName,
  literalPropertyName,
  nodeLocation,
  parseWorkflowProgram,
  topLevelConstants,
  walkWorkflowNodes,
  type WorkflowIdentifierResolver,
  type WorkflowNode,
} from './claude-workflow-ast.js';

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
function evaluateOptions(node: WorkflowNode, resolve: WorkflowIdentifierResolver) {
  const options: Record<string, unknown> = {};
  let unresolvedProperties = 0;
  for (const property of childNodes(node, 'properties')) {
    try {
      const value = property ? childNode(property, 'value') : undefined;
      if (property?.type !== 'Property' || !value) throw new TypeError('not a plain property');
      options[literalPropertyName(property)] = evaluateWorkflowLiteral(value, resolve);
    } catch {
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

/** A property's literal name (identifier or quoted), or `undefined` for a computed one. */
function propertyNameOrUndefined(property: WorkflowNode): string | undefined {
  try {
    return literalPropertyName(property);
  } catch {
    return undefined;
  }
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
    (property) => property?.type === 'Property' && propertyNameOrUndefined(property) === 'phase',
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
  const resolve: WorkflowIdentifierResolver = (name) => constants.get(name);
  const found: Found = {
    ok: true,
    agents: [],
    agentsWithoutLiteralOptions: 0,
    workflowReferences: [],
    workflowReferencesUnresolved: 0,
    phases: [],
  };
  walkWorkflowNodes(parsed.program, (node) => {
    if (node.type === 'CallExpression') recordCall(found, node, resolve);
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
