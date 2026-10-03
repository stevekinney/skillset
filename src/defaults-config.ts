import { parse } from 'yaml';
import { z } from 'zod';

import type { Issue } from './doctor.js';
import { isMapping } from './frontmatter.js';

/**
 * What settings.json `effortLevel` accepts in Claude Code 2.1.288: exactly
 * these four levels. `max`, integers, and `ultracode` are rejected, and Claude
 * Code silently treats an invalid value as unset. Skill and subagent
 * frontmatter `effort` is a different enum (it adds `max` and integers).
 */
export const claudeSettingsEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);

/** A Claude Code settings.json `effortLevel` value. */
export type ClaudeSettingsEffort = z.infer<typeof claudeSettingsEffortSchema>;

/**
 * The defaults.yaml source: model/effort defaults for each tool. Claude keys
 * land in settings.json (`model`, `effortLevel`); Codex keys land as
 * top-level config.toml scalars.
 */
export const defaultsSourceSchema = z.object({
  claude: z
    .object({
      model: z.string().optional(),
      effort: claudeSettingsEffortSchema.optional(),
    })
    .optional(),
  codex: z
    .object({
      model: z.string().optional(),
      model_reasoning_effort: z.string().min(1).optional(),
      model_verbosity: z.enum(['low', 'medium', 'high']).optional(),
    })
    .optional(),
});

/** The validated defaults.yaml contents. */
export type DefaultsSource = z.infer<typeof defaultsSourceSchema>;

/**
 * Parse and validate defaults.yaml.
 *
 * @throws {Error} If the YAML is malformed or fails the schema.
 */
export function parseDefaultsSource(raw: string): DefaultsSource {
  const parsed: unknown = parse(raw);
  if (!isMapping(parsed)) throw new Error('defaults.yaml must be a YAML mapping');

  return defaultsSourceSchema.parse(parsed);
}

/** The settings.json keys the Claude defaults compile to. */
export function claudeDefaultEntries(source: DefaultsSource): Record<string, string> {
  const entries: Record<string, string> = {};
  if (source.claude?.model) entries['model'] = source.claude.model;
  if (source.claude?.effort) entries['effortLevel'] = source.claude.effort;

  return entries;
}

/** The config.toml top-level scalars the Codex defaults compile to. */
export function codexDefaultEntries(source: DefaultsSource): Record<string, string> {
  const entries: Record<string, string> = {};
  if (source.codex?.model) entries['model'] = source.codex.model;
  if (source.codex?.model_reasoning_effort) {
    entries['model_reasoning_effort'] = source.codex.model_reasoning_effort;
  }
  if (source.codex?.model_verbosity) entries['model_verbosity'] = source.codex.model_verbosity;

  return entries;
}

/** Doctor checks for defaults.yaml. */
export function checkDefaultsSource(source: DefaultsSource): Issue[] {
  if (!source.claude && !source.codex) {
    return [
      {
        severity: 'warning',
        message: 'defaults.yaml has neither a `claude` nor a `codex` block — nothing to sync',
      },
    ];
  }

  return [];
}
