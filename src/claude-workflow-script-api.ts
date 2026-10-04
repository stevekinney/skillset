import type {
  ClaudeWorkflowEffort,
  ClaudeWorkflowIsolation,
} from './claude-workflow-agent-options.js';
import type { ClaudeWorkflowReference } from './claude-workflow-tool.js';

/**
 * Types for the globals Claude Code gives a workflow script: `agent`,
 * `pipeline`, `parallel`, `phase`, `log`, `workflow`, `args`, and `budget`.
 * Scripts are plain JavaScript, so use these through `// @ts-check` (see
 * `@lostgradient/skillset/workflow-globals`) rather than by importing them.
 */

/** The root of an `agent()` output schema: a JSON Schema object with `properties`. */
export interface ClaudeWorkflowSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean | Record<string, unknown>;
  [keyword: string]: unknown;
}

type Simplify<Type> = { [Key in keyof Type]: Type[Key] };

type PrimitiveTypes = {
  string: string;
  number: number;
  integer: number;
  boolean: boolean;
  null: null;
};

// Only literal keys make a property required. A list widened to `string[]` names
// no particular key, so it leaves every property optional rather than all required.
type RequiredKeys<Schema> = Schema extends { required: readonly (infer Key)[] }
  ? string extends Key
    ? never
    : Key
  : never;

type ObjectResult<Schema> = Schema extends { properties: infer Properties }
  ? Simplify<
      {
        [Key in keyof Properties & RequiredKeys<Schema> & string]: ClaudeWorkflowSchemaResult<
          Properties[Key]
        >;
      } & {
        [
          Key in Exclude<keyof Properties & string, RequiredKeys<Schema>>
        ]?: ClaudeWorkflowSchemaResult<Properties[Key]>;
      }
    >
  : Record<string, unknown>;

/**
 * The TypeScript type of a value that matches a JSON Schema literal: `type`
 * (including `object` with `properties` and `required`, and `array` with
 * `items`), `enum`, `const`, `anyOf`, and `oneOf`. A keyword it does not model
 * gives `unknown` for that part, never a wrong type.
 */
export type ClaudeWorkflowSchemaResult<Schema> = Schema extends { enum: readonly (infer Value)[] }
  ? Value
  : Schema extends { const: infer Value }
    ? Value
    : Schema extends { anyOf: readonly (infer Member)[] }
      ? ClaudeWorkflowSchemaResult<Member>
      : Schema extends { oneOf: readonly (infer Member)[] }
        ? ClaudeWorkflowSchemaResult<Member>
        : Schema extends { type: 'object' }
          ? ObjectResult<Schema>
          : Schema extends { type: 'array' }
            ? Schema extends { items: infer Items }
              ? ClaudeWorkflowSchemaResult<Items>[]
              : unknown[]
            : Schema extends { type: infer Name extends keyof PrimitiveTypes }
              ? PrimitiveTypes[Name]
              : unknown;

/** The options of an `agent()` call, other than `schema`. */
export interface ClaudeWorkflowAgentCallOptions {
  /** Overrides the label shown in the progress view. */
  label?: string;
  /** Assigns the agent to a progress group. Prefer it inside `pipeline()` and `parallel()`. */
  phase?: string;
  /** Overrides the model. Omit it to inherit the session's. */
  model?: string;
  /** Overrides the reasoning effort. Omit it to inherit the session's. */
  effort?: ClaudeWorkflowEffort;
  /** Runs the agent in a fresh git worktree. Expensive: use it only for parallel file edits. */
  isolation?: ClaudeWorkflowIsolation;
  /** A custom subagent type, from the same registry as the Agent tool. */
  agentType?: string;
}

/**
 * `agent(prompt, options?)`: spawn one subagent. With a `schema` it returns the
 * validated object, typed from the schema; without one it returns the agent's
 * final text. Either is `null` if the agent was skipped or died on an API error.
 */
export interface ClaudeWorkflowAgent {
  <const Schema extends ClaudeWorkflowSchemaObject>(
    prompt: string,
    options: ClaudeWorkflowAgentCallOptions & { schema: Schema },
  ): Promise<ClaudeWorkflowSchemaResult<Schema> | null>;
  (
    prompt: string,
    options?: ClaudeWorkflowAgentCallOptions & { schema?: undefined },
  ): Promise<string | null>;
}

/** One `pipeline()` stage. `previous` is the prior stage's result (the item, for the first stage). */
export type ClaudeWorkflowPipelineStage<Previous, Item, Result> = (
  previous: Previous,
  item: Item,
  index: number,
) => Result;

/**
 * `pipeline(items, ...stages)`: run each item through every stage with no
 * barrier between stages. A stage that throws drops that item to `null`.
 * Typed through six stages; past that, the stages are untyped.
 */
export interface ClaudeWorkflowPipeline {
  <Item, R1>(
    items: readonly Item[],
    stage1: ClaudeWorkflowPipelineStage<Item, Item, R1>,
  ): Promise<Array<Awaited<R1> | null>>;
  <Item, R1, R2>(
    items: readonly Item[],
    stage1: ClaudeWorkflowPipelineStage<Item, Item, R1>,
    stage2: ClaudeWorkflowPipelineStage<Awaited<R1>, Item, R2>,
  ): Promise<Array<Awaited<R2> | null>>;
  <Item, R1, R2, R3>(
    items: readonly Item[],
    stage1: ClaudeWorkflowPipelineStage<Item, Item, R1>,
    stage2: ClaudeWorkflowPipelineStage<Awaited<R1>, Item, R2>,
    stage3: ClaudeWorkflowPipelineStage<Awaited<R2>, Item, R3>,
  ): Promise<Array<Awaited<R3> | null>>;
  <Item, R1, R2, R3, R4>(
    items: readonly Item[],
    stage1: ClaudeWorkflowPipelineStage<Item, Item, R1>,
    stage2: ClaudeWorkflowPipelineStage<Awaited<R1>, Item, R2>,
    stage3: ClaudeWorkflowPipelineStage<Awaited<R2>, Item, R3>,
    stage4: ClaudeWorkflowPipelineStage<Awaited<R3>, Item, R4>,
  ): Promise<Array<Awaited<R4> | null>>;
  <Item, R1, R2, R3, R4, R5>(
    items: readonly Item[],
    stage1: ClaudeWorkflowPipelineStage<Item, Item, R1>,
    stage2: ClaudeWorkflowPipelineStage<Awaited<R1>, Item, R2>,
    stage3: ClaudeWorkflowPipelineStage<Awaited<R2>, Item, R3>,
    stage4: ClaudeWorkflowPipelineStage<Awaited<R3>, Item, R4>,
    stage5: ClaudeWorkflowPipelineStage<Awaited<R4>, Item, R5>,
  ): Promise<Array<Awaited<R5> | null>>;
  <Item, R1, R2, R3, R4, R5, R6>(
    items: readonly Item[],
    stage1: ClaudeWorkflowPipelineStage<Item, Item, R1>,
    stage2: ClaudeWorkflowPipelineStage<Awaited<R1>, Item, R2>,
    stage3: ClaudeWorkflowPipelineStage<Awaited<R2>, Item, R3>,
    stage4: ClaudeWorkflowPipelineStage<Awaited<R3>, Item, R4>,
    stage5: ClaudeWorkflowPipelineStage<Awaited<R4>, Item, R5>,
    stage6: ClaudeWorkflowPipelineStage<Awaited<R5>, Item, R6>,
  ): Promise<Array<Awaited<R6> | null>>;
  (
    items: readonly any[],
    ...stages: Array<ClaudeWorkflowPipelineStage<any, any, unknown>>
  ): Promise<unknown[]>;
}

/**
 * `parallel(thunks)`: run tasks concurrently and wait for all of them. A thunk
 * that throws resolves to `null`, so filter the results before using them.
 */
export type ClaudeWorkflowParallel = <Thunks extends readonly (() => unknown)[] | readonly []>(
  thunks: Thunks,
) => Promise<{
  -readonly [Index in keyof Thunks]: Awaited<
    ReturnType<Extract<Thunks[Index], () => unknown>>
  > | null;
}>;

/** The `budget` global. `total` is `null` unless the user set a "+500k"-style target. */
export interface ClaudeWorkflowBudgetApi {
  total: number | null;
  /** Output tokens spent this turn across the main loop and every workflow. */
  spent(): number;
  /** `max(0, total - spent())`, or `Infinity` with no target. */
  remaining(): number;
}

/** Every global Claude Code defines for a workflow script. */
export interface ClaudeWorkflowScriptGlobals {
  agent: ClaudeWorkflowAgent;
  pipeline: ClaudeWorkflowPipeline;
  parallel: ClaudeWorkflowParallel;
  /** Start a progress group. Pass the same title as a `meta.phases` entry. */
  phase(title: string): void;
  /** Show a message above the progress tree. */
  log(message: string): void;
  /** Run another workflow inline and return its result. Nesting is one level deep. */
  workflow<Result = unknown>(reference: ClaudeWorkflowReference, args?: unknown): Promise<Result>;
  /** The Workflow tool's `args`, verbatim. `undefined` when none were passed. */
  args: any;
  budget: ClaudeWorkflowBudgetApi;
}
