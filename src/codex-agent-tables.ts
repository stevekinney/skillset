import { z } from 'zod';

// The `[skills]` and `[tools]` tables of a Codex agent role file (verified
// October 2026 against config.schema.json, skills_config.rs, and role.rs at
// rust-v0.160.0). A role file is validated as a whole `config.toml`, so the
// shapes below are the config.toml ones. Tables are loose so unknown keys
// survive into the emitted TOML; doctor reports them as warnings.

const skillRuleSchema = z.looseObject({
  /** An absolute path, or one relative to the role file. */
  path: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean(),
});

const SKILL_RULE_FIELDS = new Set(Object.keys(skillRuleSchema.shape));

const bundledSkillsSchema = z.looseObject({ enabled: z.boolean().optional() });

/** Codex's `[skills]` table: `[[skills.config]]` rules plus bundled-skill settings. */
export const codexSkillsSchema = z.looseObject({
  bundled: bundledSkillsSchema.optional(),
  include_instructions: z.boolean().optional(),
  max_context_tokens: z.number().int().min(1).optional(),
  config: z.array(skillRuleSchema).optional(),
});

/** A validated Codex `[skills]` table. */
export type CodexSkills = z.infer<typeof codexSkillsSchema>;

const enabledToggleSchema = z.looseObject({ enabled: z.boolean().optional() });

const webSearchSchema = z.looseObject({
  allowed_domains: z.array(z.string()).optional(),
  context_size: z.enum(['low', 'medium', 'high']).optional(),
  location: z
    .looseObject({
      city: z.string().optional(),
      country: z.string().optional(),
      region: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

/**
 * Codex's `[tools]` table. It is a table of per-tool settings, not an
 * allowlist: Codex 0.160 has no per-agent tool allowlist array.
 */
export const codexToolsSchema = z.looseObject({
  experimental_request_user_input: enabledToggleSchema.optional(),
  update_plan: enabledToggleSchema.optional(),
  web_search: webSearchSchema.optional(),
});

/** A validated Codex `[tools]` table. */
export type CodexTools = z.infer<typeof codexToolsSchema>;

function extraKeys(value: object, shape: object): string[] {
  return Object.keys(value).filter((key) => !(key in shape));
}

/** Paths (`skills.<field>`, `skills.config[i].<field>`) Codex does not read. */
export function unknownCodexSkillFields(skills: CodexSkills): string[] {
  const unknown = extraKeys(skills, codexSkillsSchema.shape).map((key) => `skills.${key}`);

  if (skills.bundled) {
    unknown.push(
      ...extraKeys(skills.bundled, bundledSkillsSchema.shape).map((key) => `skills.bundled.${key}`),
    );
  }
  for (const [index, rule] of (skills.config ?? []).entries()) {
    unknown.push(
      ...Object.keys(rule)
        .filter((key) => !SKILL_RULE_FIELDS.has(key))
        .map((key) => `skills.config[${index}].${key}`),
    );
  }

  return unknown;
}

/** Indexes of `skills.config` rules that set both or neither of `path` and `name`. */
export function ambiguousCodexSkillRules(skills: CodexSkills): number[] {
  return (skills.config ?? []).flatMap((rule, index) =>
    (rule.path === undefined) === (rule.name === undefined) ? [index] : [],
  );
}

/**
 * Whether a `[skills]` table holds anything Codex 0.160 applies to a
 * subagent. Role files only keep restrictive settings: `enabled = false`
 * rules, a disabled bundled set, and `include_instructions = false`.
 */
export function hasEffectiveCodexSkillSettings(skills: CodexSkills): boolean {
  return (
    (skills.config ?? []).some((rule) => !rule.enabled) ||
    skills.bundled?.enabled === false ||
    skills.include_instructions === false
  );
}

/** Paths (`tools.<field>`, `tools.web_search.location.<field>`) Codex does not read. */
export function unknownCodexToolFields(tools: CodexTools): string[] {
  const unknown = extraKeys(tools, codexToolsSchema.shape).map((key) => `tools.${key}`);

  for (const key of ['experimental_request_user_input', 'update_plan'] as const) {
    const toggle = tools[key];
    if (toggle) {
      unknown.push(
        ...extraKeys(toggle, enabledToggleSchema.shape).map((field) => `tools.${key}.${field}`),
      );
    }
  }

  const search = tools.web_search;
  if (search) {
    unknown.push(
      ...extraKeys(search, webSearchSchema.shape).map((key) => `tools.web_search.${key}`),
    );
    if (search.location) {
      unknown.push(
        ...extraKeys(search.location, webSearchSchema.shape.location.unwrap().shape).map(
          (key) => `tools.web_search.location.${key}`,
        ),
      );
    }
  }

  return unknown;
}
