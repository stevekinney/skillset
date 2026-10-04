import { afterAll, describe, expect, it } from 'bun:test';

import type { ClaudeWorkflowAgentOptions } from './claude-workflow-agent-options.js';
import type * as _Globals from './claude-workflow-globals.js';
import type {
  ClaudeWorkflowAgentCallOptions,
  ClaudeWorkflowSchemaResult,
} from './claude-workflow-script-api.js';

/**
 * The script API is types only, so these tests are checked by
 * `bun run typecheck:test`: `@ts-expect-error` fails the build if a line that
 * must be rejected is accepted. The runtime assertions only keep the file
 * from being empty.
 */

/* oxlint-disable typescript/no-unnecessary-type-parameters */
type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? true
    : false;
const assertType = <_Check extends true>() => undefined;
/* oxlint-enable typescript/no-unnecessary-type-parameters */

// Every documented option exists on both the schema and the script-facing type.
assertType<
  Equal<
    keyof ClaudeWorkflowAgentCallOptions,
    'label' | 'phase' | 'model' | 'effort' | 'isolation' | 'agentType'
  >
>();
assertType<Equal<ClaudeWorkflowAgentCallOptions['effort'], ClaudeWorkflowAgentOptions['effort']>>();
assertType<
  Equal<ClaudeWorkflowAgentCallOptions['isolation'], ClaudeWorkflowAgentOptions['isolation']>
>();

const objectSchema = {
  type: 'object',
  required: ['files', 'count'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    count: { type: 'integer' },
    note: { type: 'string' },
    kind: { enum: ['a', 'b'] },
    either: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

assertType<
  Equal<
    ClaudeWorkflowSchemaResult<typeof objectSchema>,
    {
      files: string[];
      count: number;
      note?: string;
      kind?: 'a' | 'b';
      either?: string | null;
    }
  >
>();
// A `required` list widened to `string[]` (from `satisfies`, say) names no
// particular key, so every property stays optional rather than all required.
type WidenedRequired = {
  type: 'object';
  properties: { name: { type: 'string' } };
  required: string[];
};
assertType<Equal<ClaudeWorkflowSchemaResult<WidenedRequired>, { name?: string }>>();
assertType<Equal<ClaudeWorkflowSchemaResult<{ type: 'object' }>, Record<string, unknown>>>();
assertType<Equal<ClaudeWorkflowSchemaResult<{ type: 'array' }>, unknown[]>>();
assertType<Equal<ClaudeWorkflowSchemaResult<{ const: 'x' }>, 'x'>>();
assertType<Equal<ClaudeWorkflowSchemaResult<{ oneOf: [{ type: 'boolean' }] }>, boolean>>();
assertType<Equal<ClaudeWorkflowSchemaResult<{ description: 'untyped' }>, unknown>>();

async function typedScript() {
  const found = await agent('List', { schema: objectSchema });
  assertType<Equal<NonNullable<typeof found>['count'], number>>();
  const text = await agent('Summarize', { effort: 'low', isolation: 'worktree' });
  assertType<Equal<typeof text, string | null>>();
  const noOptions = await agent('Hello');
  assertType<Equal<typeof noOptions, string | null>>();

  const audits = await pipeline(
    ['a.ts'],
    (file) => agent(`Audit ${file}`),
    (previous, file, index) => ({ previous, file, index }),
  );
  assertType<
    Equal<typeof audits, Array<{ previous: string | null; file: string; index: number } | null>>
  >();
  const one = await pipeline([1], (value) => value + 1);
  assertType<Equal<typeof one, Array<number | null>>>();
  const six = await pipeline(
    [1],
    (value) => value,
    (value) => value,
    (value) => value,
    (value) => value,
    (value) => value,
    async (value) => String(value),
  );
  assertType<Equal<typeof six, Array<string | null>>>();
  const untyped = await pipeline(
    [1],
    (a) => a,
    (a) => a,
    (a) => a,
    (a) => a,
    (a) => a,
    (a) => a,
    (a) => a,
  );
  assertType<Equal<typeof untyped, unknown[]>>();

  const both = await parallel([() => agent('a'), async () => 1]);
  assertType<Equal<typeof both, [string | null, number | null]>>();
  const many = await parallel(['a', 'b'].map((name) => () => agent(name)));
  assertType<Equal<typeof many, Array<string | null>>>();

  phase('Scan');
  log('message');
  const child = await workflow<{ ok: boolean }>({ scriptPath: '/tmp/child.js' }, args);
  assertType<Equal<typeof child, { ok: boolean }>>();
  assertType<Equal<typeof budget.total, number | null>>();
  return budget.remaining() + budget.spent();
}

async function rejectedScript() {
  // @ts-expect-error effort is a closed set
  await agent('x', { effort: 'extreme' });
  // @ts-expect-error isolation is only 'worktree'
  await agent('x', { isolation: 'remote' });
  // @ts-expect-error the schema root must be an object schema
  await agent('x', { schema: { type: 'string' } });
  // @ts-expect-error the prompt is a string
  await agent(1);
  // @ts-expect-error phase takes a title
  phase();
  await pipeline(
    [1],
    (value) => String(value),
    // @ts-expect-error a stage sees the type the previous stage returned
    (previous) => previous.toFixed(),
  );
}

/** Stand-ins for the runtime's globals, so the typed scripts above also run. */
function installRuntimeStubs() {
  Object.assign(globalThis, {
    agent: async (_prompt: string, options?: { schema?: unknown }) =>
      options?.schema ? { files: ['a.ts'], count: 1, x: 1 } : 'text',
    pipeline: async (items: unknown[], ...stages: Array<(...stageArgs: unknown[]) => unknown>) =>
      Promise.all(
        items.map(async (item, index) => {
          let previous: unknown = item;
          for (const stage of stages) previous = await stage(previous, item, index);
          return previous;
        }),
      ),
    parallel: async (thunks: Array<() => unknown>) => Promise.all(thunks.map((thunk) => thunk())),
    phase: () => undefined,
    log: () => undefined,
    workflow: async () => ({ ok: true }),
    args: [],
    budget: { total: null, spent: () => 1, remaining: () => 2 },
  });
}

const stubNames = ['agent', 'pipeline', 'parallel', 'phase', 'log', 'workflow', 'args', 'budget'];
afterAll(() => {
  for (const name of stubNames) Reflect.deleteProperty(globalThis, name);
});

describe('workflow script API types', () => {
  it('is checked by the type checker and runs against stand-in globals', async () => {
    installRuntimeStubs();
    expect(await typedScript()).toBe(3);
    let failure: unknown;
    try {
      await rejectedScript();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TypeError);
  });
});
