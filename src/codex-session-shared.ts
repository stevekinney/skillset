import { z } from 'zod';

/**
 * Building blocks shared by every Codex rollout (session JSONL) schema module:
 * configuration enums, sandbox and permission profiles, token usage.
 *
 * Sources: `codex-rs/protocol/src/{protocol,models,config_types,permissions,
 * openai_models,account}.rs` at `rust-v0.160.0`, checked against every rollout
 * file on the author's machine (see `scripts/check-codex-session-schema.ts`).
 * Every object is a `z.looseObject` so a field a newer Codex adds never fails a
 * parse.
 */

/**
 * A string with a documented set of known values that Codex nevertheless
 * leaves open (a Rust `Custom(String)`/`Feature(String)` variant, a plugin or
 * model supplied name). It parses any string; the known values document intent
 * and let the checker report values it has not seen.
 */
export function openEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  return z.union([z.enum(values), z.string()]);
}

/**
 * `ReasoningEffort`. Rust writes a `Custom(String)` variant as the bare string
 * (`codex-rs/protocol/src/openai_models.rs`), so the set is open: the nine
 * built-in levels plus any string a model or a newer Codex defines.
 */
export const reasoningEffortSchema = openEnum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'persistent',
]);

export const reasoningSummarySchema = z.enum(['auto', 'concise', 'detailed', 'none']);

export const personalitySchema = z.enum(['none', 'friendly', 'pragmatic']);

/** `ModeKind`; the legacy aliases `code`, `pair_programming`, `execute` and `custom` are read as `default`. */
export const modeKindSchema = z.enum(['default', 'plan']);

/** `AskForApproval`; `granular` is the externally tagged data variant. */
export const approvalPolicySchema = z.union([
  z.enum(['untrusted', 'on-failure', 'on-request', 'never']),
  z.looseObject({
    granular: z.looseObject({
      sandbox_approval: z.boolean(),
      rules: z.boolean(),
      skill_approval: z.boolean().optional(),
      request_permissions: z.boolean().optional(),
      mcp_elicitations: z.boolean(),
    }),
  }),
]);

/** `guardian_subagent` is the legacy spelling of `auto_review`. */
export const approvalsReviewerSchema = z.enum(['user', 'auto_review', 'guardian_subagent']);

export const collaborationModeSchema = z.looseObject({
  mode: modeKindSchema,
  settings: z.looseObject({
    model: z.string(),
    reasoning_effort: reasoningEffortSchema.nullable(),
    developer_instructions: z.string().nullable(),
  }),
});

export const multiAgentVersionSchema = z.enum(['disabled', 'v1', 'v2']);

/** `MultiAgentMode` has an open `Custom(String)` variant. */
export const multiAgentModeSchema = openEnum(['explicitRequestOnly', 'proactive']);

export const cyberAccessProgramSchema = z.enum(['standard']);

export const historyModeSchema = z.enum(['legacy', 'paginated']);

export const networkPolicySchema = z.enum(['restricted', 'enabled']);

/** The legacy sandbox policy, tagged on `type`. */
export const sandboxPolicySchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('danger-full-access') }),
  z.looseObject({ type: z.literal('read-only'), network_access: z.boolean().optional() }),
  z.looseObject({
    type: z.literal('external-sandbox'),
    network_access: networkPolicySchema.optional(),
  }),
  z.looseObject({
    type: z.literal('workspace-write'),
    writable_roots: z.array(z.string()).optional(),
    network_access: z.boolean().optional(),
    exclude_tmpdir_env_var: z.boolean().optional(),
    exclude_slash_tmp: z.boolean().optional(),
  }),
]);

const fileSystemSpecialPathSchema = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('root') }),
  z.looseObject({ kind: z.literal('minimal') }),
  z.looseObject({ kind: z.literal('project_roots'), subpath: z.string().optional() }),
  z.looseObject({ kind: z.literal('tmpdir') }),
  z.looseObject({ kind: z.literal('slash_tmp') }),
  z.looseObject({ kind: z.literal('unknown'), path: z.string(), subpath: z.string().optional() }),
]);

const fileSystemPathSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('path'), path: z.string() }),
  z.looseObject({ type: z.literal('glob_pattern'), pattern: z.string() }),
  z.looseObject({ type: z.literal('special'), value: fileSystemSpecialPathSchema }),
]);

/** `deny` is also read from the legacy spelling `none`. */
export const fileSystemEntrySchema = z.looseObject({
  path: fileSystemPathSchema,
  access: z.enum(['read', 'write', 'deny', 'none']),
  missing_path_behavior: z.enum(['skip']).optional(),
});

/** The `file_system_sandbox_policy` written next to `sandbox_policy` by older turn contexts. */
export const fileSystemSandboxPolicySchema = z.looseObject({
  kind: z.enum(['restricted', 'unrestricted', 'external-sandbox']),
  glob_scan_max_depth: z.number().optional(),
  entries: z.array(fileSystemEntrySchema).optional(),
});

/** `PermissionProfile`, tagged on `type`. */
export const permissionProfileSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('managed'),
    file_system: z.discriminatedUnion('type', [
      z.looseObject({
        type: z.literal('restricted'),
        entries: z.array(fileSystemEntrySchema),
        glob_scan_max_depth: z.number().optional(),
      }),
      z.looseObject({ type: z.literal('unrestricted') }),
    ]),
    network: networkPolicySchema,
  }),
  z.looseObject({ type: z.literal('disabled') }),
  z.looseObject({ type: z.literal('external'), network: networkPolicySchema }),
]);

export const activePermissionProfileSchema = z.looseObject({
  id: z.string(),
  extends: z.string().optional(),
});

/** Token counters; `cache_write_input_tokens` defaults to zero in Rust, so older files omit it. */
export const tokenUsageSchema = z.looseObject({
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  cache_write_input_tokens: z.number().optional(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number(),
  total_tokens: z.number(),
});

/** A `Duration` as serde writes it. */
export const durationSchema = z.looseObject({ secs: z.number(), nanos: z.number() });

/** `PlanType`; unrecognized plans deserialize as `unknown`. */
export const planTypeSchema = z.enum([
  'free',
  'go',
  'plus',
  'pro',
  'prolite',
  'promax',
  'team',
  'self_serve_business_prolite',
  'self_serve_business_usage_based',
  'business',
  'ent26',
  'enterprise_cbp_automation',
  'enterprise_cbp_usage_based',
  'enterprise',
  'edu',
  'edu_plus',
  'edu_pro',
  'unknown',
]);
