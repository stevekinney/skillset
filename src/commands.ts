import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { stringify as stringifyToml } from 'smol-toml';
import { parse, stringify } from 'yaml';
import { z } from 'zod';

import { emitClaudeAgent, emitCodexAgent } from './agent-emit.js';
import { agentFrontmatterSchema } from './agent-frontmatter.js';
import type { Sources } from './discover.js';
import { checkAgent, checkSkill, type Issue } from './doctor.js';
import { emitSkill } from './emit.js';
import {
  isMapping,
  serializeFrontmatter,
  skillFrontmatterSchema,
  splitFrontmatter,
  type Target,
} from './frontmatter.js';
import { claudeMcpEntry, codexMcpSection, parseMcpSource } from './mcp-config.js';

/** The two editable source kinds. MCP is a single YAML file, edited directly. */
export type SourceKind = 'skill' | 'agent';

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function sourceFilePath(root: string, kind: SourceKind, name: string): string {
  return kind === 'skill'
    ? join(root, 'skills', name, 'SKILL.md')
    : join(root, 'agents', `${name}.md`);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** One row of `skillset list`. */
export type ListEntry = {
  kind: 'skill' | 'agent' | 'mcp-server';
  name: string;
  status: 'ok' | 'warnings' | 'errors';
};

function statusOf(issues: Issue[]): ListEntry['status'] {
  if (issues.some((issue) => issue.severity === 'error')) return 'errors';

  return issues.length > 0 ? 'warnings' : 'ok';
}

/** Build the structured listing of every source, with doctor status. */
export function listEntries(sources: Sources): ListEntry[] {
  const entries: ListEntry[] = [
    ...sources.skills.map((skill): ListEntry => ({
      kind: 'skill',
      name: skill.name,
      status: statusOf(checkSkill(skill).issues),
    })),
    ...sources.agents.map((agent): ListEntry => ({
      kind: 'agent',
      name: agent.name,
      status: statusOf(checkAgent(agent).issues),
    })),
  ];

  if (sources.mcp) {
    try {
      const parsed = parseMcpSource(sources.mcp.raw);
      for (const name of Object.keys(parsed.source.servers)) {
        entries.push({ kind: 'mcp-server', name, status: 'ok' });
      }
    } catch {
      entries.push({ kind: 'mcp-server', name: '(mcp-servers.yaml)', status: 'errors' });
    }
  }

  return entries;
}

/** A compiled preview of one source for one target. */
export type ShowFile = {
  target: Target;
  /** A label for the emitted artifact (destination-relative). */
  label: string;
  contents: string;
};

/**
 * Compile a named source (skill, agent, or MCP server) for preview.
 *
 * @throws {Error} If the name matches nothing or the source fails to compile.
 */
export function showSource(sources: Sources, name: string, targets: Target[]): ShowFile[] {
  const skill = sources.skills.find((candidate) => candidate.name === name);
  if (skill) {
    const report = checkSkill(skill);
    if (!report.parsed) throw new Error(`skill \`${name}\` has errors — run \`skillset doctor\``);
    const parsed = report.parsed;

    return targets.flatMap((target) =>
      emitSkill(parsed, target).map((file) => ({
        target,
        label: `${name}/${file.relativePath}`,
        contents: file.contents,
      })),
    );
  }

  const agent = sources.agents.find((candidate) => candidate.name === name);
  if (agent) {
    const report = checkAgent(agent);
    if (!report.parsed) throw new Error(`agent \`${name}\` has errors — run \`skillset doctor\``);
    const parsed = report.parsed;

    return targets.map((target) => ({
      target,
      label: target === 'claude' ? `${name}.md` : `${name}.toml`,
      contents: target === 'claude' ? emitClaudeAgent(parsed) : emitCodexAgent(parsed),
    }));
  }

  const server = sources.mcp ? parseMcpSource(sources.mcp.raw).source.servers[name] : undefined;
  if (server) {
    return targets.map((target) => ({
      target,
      label: target === 'claude' ? `mcpServers.${name}` : `[mcp_servers.${name}]`,
      contents:
        target === 'claude'
          ? JSON.stringify(claudeMcpEntry(server), undefined, 2)
          : stringifyToml({ mcp_servers: { [name]: codexMcpSection(server) } }),
    }));
  }

  throw new Error(`no skill, agent, or MCP server named \`${name}\``);
}

function skillTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: Describe what this skill does and when to use it.\n---\n\n# ${name}\n\nWrite the skill instructions here.\n`;
}

function agentTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: Describe when this agent should be used.\n---\n\nYou are the ${name} agent. Write the system prompt here.\n`;
}

/**
 * Scaffold a new doctor-clean source file.
 *
 * @throws {Error} If the name is invalid or the source already exists.
 * @returns The path of the created file.
 */
export async function newSource(root: string, kind: SourceKind, name: string): Promise<string> {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`\`${name}\` is not a valid ${kind} name (lowercase alphanumeric + hyphens)`);
  }

  const path = sourceFilePath(root, kind, name);
  if (await exists(path)) throw new Error(`${kind} \`${name}\` already exists at ${path}`);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, kind === 'skill' ? skillTemplate(name) : agentTemplate(name), 'utf8');

  return path;
}

/**
 * Delete a source (the whole skill directory, or the agent file).
 *
 * @throws {Error} If the source does not exist.
 * @returns The path that was removed.
 */
export async function removeSource(root: string, kind: SourceKind, name: string): Promise<string> {
  const filePath = sourceFilePath(root, kind, name);
  if (!(await exists(filePath))) throw new Error(`no ${kind} named \`${name}\``);

  const removed = kind === 'skill' ? dirname(filePath) : filePath;
  await rm(removed, { recursive: true, force: true });

  return removed;
}

function getPath(value: unknown, segments: string[]): unknown {
  let current = value;

  for (const segment of segments) {
    if (!isMapping(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function setPath(mapping: Record<string, unknown>, segments: string[], value: unknown): void {
  let current = mapping;

  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (isMapping(next)) {
      current = next;
    } else {
      const fresh: Record<string, unknown> = {};
      current[segment] = fresh;
      current = fresh;
    }
  }

  const last = segments.at(-1)!;
  if (value === undefined) {
    delete current[last];
  } else {
    current[last] = value;
  }
}

async function readSourceFile(
  root: string,
  kind: SourceKind,
  name: string,
): Promise<{ path: string; raw: string }> {
  const path = sourceFilePath(root, kind, name);
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) throw new Error(`no ${kind} named \`${name}\``);

  return { path, raw };
}

/**
 * Read a source's frontmatter, or one field of it via a dot path.
 *
 * @throws {Error} If the source does not exist.
 */
export async function getField(
  root: string,
  kind: SourceKind,
  name: string,
  fieldPath?: string,
): Promise<unknown> {
  const { raw } = await readSourceFile(root, kind, name);
  const { mapping } = splitFrontmatter(raw);

  return fieldPath === undefined ? mapping : getPath(mapping, fieldPath.split('.'));
}

/**
 * Set (or, with an empty value, delete) one frontmatter field via a dot path.
 * The value is parsed as YAML, the result is re-validated against the union
 * schema, and the body is preserved byte-for-byte.
 *
 * @throws {Error} If the source does not exist or the write would be invalid.
 */
export async function setField(
  root: string,
  kind: SourceKind,
  name: string,
  fieldPath: string,
  value: string,
): Promise<void> {
  const { path, raw } = await readSourceFile(root, kind, name);
  const { mapping, body } = splitFrontmatter(raw);

  const parsedValue: unknown = value === '' ? undefined : parse(value);
  setPath(mapping, fieldPath.split('.'), parsedValue);

  const schema: z.ZodType = kind === 'skill' ? skillFrontmatterSchema : agentFrontmatterSchema;
  const validation = schema.safeParse(mapping);
  if (!validation.success) {
    const detail = validation.error.issues
      .map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`)
      .join('; ');
    throw new Error(`refusing to write invalid frontmatter — ${detail}`);
  }

  await writeFile(path, `${serializeFrontmatter(mapping)}${body}`, 'utf8');
}

/** Serialize a frontmatter mapping (or field) for display. */
export function renderValue(value: unknown, json: boolean): string {
  if (json) return JSON.stringify(value, undefined, 2);

  return typeof value === 'string' ? value : stringify(value).trimEnd();
}
