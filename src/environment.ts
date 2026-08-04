import { environmentalist } from '@lostgradient/environmentalist';
import { z } from 'zod';

/**
 * Schema for the configuration this package reads. Resolved through
 * @lostgradient/environmentalist, so values may come from the process
 * environment, a `.env` file, or a `skillset.config.*` / XDG config file —
 * not just `process.env`.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SKILLSET_DIRECTORY: z.string().optional(),
});

/** The shape of the validated environment. */
export type Environment = z.infer<typeof environmentSchema>;

function compact(source: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }

  return result;
}

type Resolved = {
  nodeEnv: Environment['NODE_ENV'];
  skillsetDirectory?: string | undefined;
};

function toEnvironment(resolved: Resolved): Environment {
  const environment: Environment = { NODE_ENV: resolved.nodeEnv };
  if (resolved.skillsetDirectory !== undefined) {
    environment.SKILLSET_DIRECTORY = resolved.skillsetDirectory;
  }

  return environment;
}

/**
 * Validate the given environment record against the schema.
 *
 * Exposed separately from {@link environment} so tests and callers can
 * validate arbitrary inputs; restricted to the injected record plus schema
 * defaults (no dotenv/config-file resolution) for determinism.
 *
 * @throws {Error} If `source` does not satisfy the schema.
 */
export function parseEnvironment(
  source: Record<string, string | undefined> = process.env,
): Environment {
  return toEnvironment(
    environmentalist.sync({
      name: 'skillset',
      schema: environmentSchema,
      env: compact(source),
      sources: ['env', 'defaults'],
    }),
  );
}

/**
 * The validated configuration, resolved once at module load through the full
 * environmentalist source chain (environment variables, dotenv, project and
 * user config files) — everything except CLI flags, which this package parses
 * itself.
 */
export const environment: Environment = toEnvironment(
  environmentalist.sync({
    name: 'skillset',
    schema: environmentSchema,
    exclude: ['flags'],
  }),
);
