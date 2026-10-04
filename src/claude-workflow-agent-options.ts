import { z } from 'zod';

/**
 * The options object a workflow script passes as the second argument of
 * `agent(prompt, options)`. Closed values are literal unions; the
 * `schema` option is a JSON Schema the subagent's structured output must match.
 */

/** Reasoning effort for one agent. Omit to inherit the session's effort. */
export const claudeWorkflowEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type ClaudeWorkflowEffort = z.infer<typeof claudeWorkflowEffortSchema>;

/**
 * Isolation for one agent. `'remote'` also parses at runtime but throws
 * "not available in this build", so only `'worktree'` is accepted here.
 */
export const claudeWorkflowIsolationSchema = z.literal('worktree');
export type ClaudeWorkflowIsolation = z.infer<typeof claudeWorkflowIsolationSchema>;

/**
 * The root of an `agent()` output schema. Claude Code requires an object with
 * `properties`, and refuses a schema it can prove contradicts itself: a
 * `required` key missing from `properties`, which `additionalProperties: false`
 * would make impossible to satisfy. Everything else is ordinary JSON Schema.
 */
export const claudeWorkflowOutputSchemaSchema = z
  .looseObject({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
  })
  .superRefine((schema, context) => {
    for (const key of schema.required ?? []) {
      if (Object.hasOwn(schema.properties, key)) continue;
      context.addIssue({
        code: 'custom',
        path: ['required'],
        message:
          schema.additionalProperties === false
            ? `required key "${key}" is not in properties, which additionalProperties: false rules out`
            : `required key "${key}" is not in properties`,
      });
    }
  });
export type ClaudeWorkflowOutputSchema = z.infer<typeof claudeWorkflowOutputSchemaSchema>;

// Trim before the length check, so a name of only whitespace is rejected.
const toolNameList = z.array(z.string().trim().min(1));

/**
 * `agent()` options. `disallowedTools`, `bashCommandClamp`, and `stallMs` are
 * read by the runtime but not in the documented script API, so treat them as
 * unstable.
 */
export const claudeWorkflowAgentOptionsSchema = z.looseObject({
  /** The label shown in the progress view. */
  label: z.string().optional(),
  /** The progress group, matching a `meta.phases` title. */
  phase: z.string().optional(),
  /** A JSON Schema the agent's structured output must match. */
  schema: claudeWorkflowOutputSchemaSchema.optional(),
  model: z.string().optional(),
  effort: claudeWorkflowEffortSchema.optional(),
  isolation: claudeWorkflowIsolationSchema.optional(),
  /** A custom subagent type from the same registry as the Agent tool. */
  agentType: z.string().optional(),
  /** Undocumented: tools the agent may not use. */
  disallowedTools: toolNameList.optional(),
  /** Undocumented: `Bash(<command or prefix>)` rules limiting the agent's Bash tool. */
  bashCommandClamp: z
    .array(
      z
        .string()
        .min(1)
        .trim()
        .regex(/^Bash\(.+\)$/s),
    )
    .optional(),
  /** Undocumented: how long an agent may go without progress, in milliseconds. */
  stallMs: z.number().optional(),
});
export type ClaudeWorkflowAgentOptions = z.infer<typeof claudeWorkflowAgentOptionsSchema>;
