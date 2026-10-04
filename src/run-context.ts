import { parseEnvironment } from './environment.js';
import type { ConfigDirectoryOverrides } from './targets.js';

export type RunContext = {
  cwd: string;
  homeDirectory: string;
  skillsetDirectory?: string | undefined;
  /**
   * The tools' own `CLAUDE_CONFIG_DIR` and `CODEX_HOME` (applied at user scope),
   * and `XDG_CONFIG_HOME`/`APPDATA`, which place the ledger.
   */
  configDirectories?: ConfigDirectoryOverrides | undefined;
  log: (line: string) => void;
};

/**
 * Build a {@link RunContext} from the process environment. `SKILLSET_DIRECTORY`
 * goes through skillset's own configuration chain; `CLAUDE_CONFIG_DIR` and
 * `CODEX_HOME` belong to the tools, so they are read only from the environment,
 * as the tools themselves read them.
 */
export function createRunContext(dependencies: {
  cwd: string;
  homeDirectory: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}): RunContext {
  const skillsetDirectory = parseEnvironment(dependencies.env).SKILLSET_DIRECTORY;

  return {
    cwd: dependencies.cwd,
    homeDirectory: dependencies.homeDirectory,
    ...(skillsetDirectory === undefined ? {} : { skillsetDirectory }),
    configDirectories: {
      claudeConfigDirectory: dependencies.env['CLAUDE_CONFIG_DIR'],
      codexHome: dependencies.env['CODEX_HOME'],
      xdgConfigHome: dependencies.env['XDG_CONFIG_HOME'],
      appData: dependencies.env['APPDATA'],
    },
    log: dependencies.log,
  };
}
