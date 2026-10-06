import { z } from 'zod';

// The `[skills]` and `[tools]` tables of a Codex agent role file (verified
// October 2026 against config.schema.json, skills_config.rs, and role.rs at
// rust-v0.160.0). A role file is validated as a whole `config.toml`, so the
// shapes below are the config.toml ones. Tables are loose so unknown keys
// survive parsing.

const skillRuleSchema = z.looseObject({
  /** An absolute path, or one relative to the role file. */
  path: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean(),
});

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
