import { impliedSandboxMode, type ParsedAgentFile } from './agent-frontmatter.js';
import {
  ambiguousCodexSkillRules,
  hasEffectiveCodexSkillSettings,
  unknownCodexSkillFields,
  unknownCodexToolFields,
} from './codex-agent-tables.js';
import type { Issue } from './doctor.js';
import { codexHookFindings } from './hook-schema.js';

function warning(message: string): Issue {
  return { severity: 'warning', message };
}

function checkCodexAgentHooks(parsed: ParsedAgentFile): Issue[] {
  const hooks = parsed.frontmatter.codex?.hooks;
  if (hooks === undefined) return [];

  const findings = codexHookFindings(hooks);

  return [
    warning(
      '`codex.hooks` is validated but not applied — Codex 0.160 drops `hooks` from an agent role file; register the hooks in config.toml or hooks.json instead',
    ),
    ...findings.unknownFields.map((path) => warning(`codex.${path} is unknown — Codex ignores it`)),
    ...findings.unknownTypes.map((path) =>
      warning(`codex.${path} has an unrecognised handler type — Codex most likely rejects it`),
    ),
    ...findings.skippedHandlers.map((path) =>
      warning(
        `codex.${path} is a \`prompt\` or \`agent\` handler — Codex parses it, then skips it`,
      ),
    ),
  ];
}

function checkCodexAgentSkills(parsed: ParsedAgentFile): Issue[] {
  const skills = parsed.frontmatter.codex?.skills;
  if (skills === undefined) return [];

  const issues = unknownCodexSkillFields(skills).map((path) =>
    warning(`codex.${path} is unknown — Codex ignores it`),
  );
  for (const index of ambiguousCodexSkillRules(skills)) {
    issues.push(
      warning(
        `codex.skills.config[${index}] should set exactly one of \`path\` or \`name\` — Codex most likely expects one selector`,
      ),
    );
  }
  if (!hasEffectiveCodexSkillSettings(skills)) {
    issues.push(
      warning(
        '`codex.skills` has no effect — Codex 0.160 applies only restrictive entries (`enabled = false`, a disabled `bundled` set, `include_instructions = false`) from an agent role file',
      ),
    );
  }

  return issues;
}

function checkCodexAgentTools(parsed: ParsedAgentFile): Issue[] {
  const tools = parsed.frontmatter.codex?.tools;
  if (tools === undefined) return [];

  return [
    warning(
      '`codex.tools` is validated but not applied — Codex 0.160 drops `tools` from an agent role file, and it has no per-agent tool allowlist',
    ),
    ...unknownCodexToolFields(tools).map((path) =>
      warning(`codex.${path} is unknown — Codex ignores it`),
    ),
  ];
}

function checkCodexAgentSandboxMode(parsed: ParsedAgentFile): Issue[] {
  const { codex, permissionMode } = parsed.frontmatter;
  const explicit = codex?.sandbox_mode;
  const sandboxMode = explicit ?? impliedSandboxMode(permissionMode);
  if (sandboxMode === undefined) return [];

  const source =
    explicit === undefined ? `implied by \`permissionMode: ${permissionMode}\`` : 'set';

  return [
    warning(
      `\`sandbox_mode\` (${source}, \`${sandboxMode}\`) is emitted but not applied — Codex 0.160 discards \`sandbox_mode\` from an agent role file even though the Codex docs still list the key; set the sandbox in config.toml or a profile instead`,
    ),
  ];
}

/** Doctor checks for the `codex.hooks`, `codex.skills`, and `codex.tools` tables and the emitted `sandbox_mode` of an agent. */
export function checkCodexAgentTables(parsed: ParsedAgentFile): Issue[] {
  return [
    ...checkCodexAgentHooks(parsed),
    ...checkCodexAgentSkills(parsed),
    ...checkCodexAgentTools(parsed),
    ...checkCodexAgentSandboxMode(parsed),
  ];
}
