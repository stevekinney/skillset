import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import { GENERATED_MARKER_TOML } from './agent-emit.js';
import { INSTRUCTIONS_SOURCE_FILENAME } from './discover.js';
import { GENERATED_MARKER } from './emit.js';
import { isMapping, serializeFrontmatter, splitFrontmatter, type Target } from './frontmatter.js';
import type { Targets } from './targets.js';

/** The source kinds `skillset import` can reverse-compile. */
export type ImportKind = 'skill' | 'agent' | 'instructions';

/** A request to adopt an installed item into the source tree. */
export type ImportRequest = {
  kind: ImportKind;
  /** Required for skills and agents; ignored for instructions. */
  name?: string;
  from: Target;
};

function stripMarker(contents: string): string {
  return contents
    .split('\n')
    .filter((line) => !line.includes(GENERATED_MARKER) && !line.includes(GENERATED_MARKER_TOML))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function refuseExisting(path: string): Promise<void> {
  if (await exists(path)) {
    throw new Error(`${path} already exists — remove it first or edit it directly`);
  }
}

async function importClaudeSkill(origin: string, destination: string): Promise<void> {
  const raw = await readFile(join(origin, 'SKILL.md'), 'utf8');
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'SKILL.md'), stripMarker(raw), 'utf8');

  for (const entry of await readdir(origin, { withFileTypes: true })) {
    if (entry.name === 'SKILL.md') continue;
    await cp(join(origin, entry.name), join(destination, entry.name), { recursive: true });
  }
}

async function importCodexSkill(origin: string, destination: string): Promise<void> {
  const raw = await readFile(join(origin, 'SKILL.md'), 'utf8');
  const { mapping, body } = splitFrontmatter(stripMarker(raw));

  const openaiRaw = await readFile(join(origin, 'agents', 'openai.yaml'), 'utf8').catch(
    () => undefined,
  );
  if (openaiRaw !== undefined) {
    const parsed: unknown = parseYaml(openaiRaw);
    if (isMapping(parsed)) mapping['openai'] = parsed;
  }

  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'SKILL.md'), `${serializeFrontmatter(mapping)}${body}`, 'utf8');

  for (const entry of await readdir(origin, { withFileTypes: true })) {
    if (entry.name === 'SKILL.md' || entry.name === 'agents') continue;
    await cp(join(origin, entry.name), join(destination, entry.name), { recursive: true });
  }
}

const CODEX_AGENT_SCALARS = [
  'model',
  'model_reasoning_effort',
  'model_verbosity',
  'sandbox_mode',
  'nickname_candidates',
] as const;

async function importCodexAgent(originPath: string, destinationPath: string): Promise<void> {
  const parsed: unknown = parseToml(await readFile(originPath, 'utf8'));
  if (!isMapping(parsed)) throw new Error(`${originPath} is not a TOML mapping`);

  const name = typeof parsed['name'] === 'string' ? parsed['name'] : undefined;
  const description = typeof parsed['description'] === 'string' ? parsed['description'] : undefined;
  if (!name || !description) {
    throw new Error(`${originPath} is missing the required name/description fields`);
  }

  const codex: Record<string, unknown> = {};
  for (const key of CODEX_AGENT_SCALARS) {
    if (parsed[key] !== undefined) codex[key] = parsed[key];
  }

  const frontmatter: Record<string, unknown> = { name, description };
  if (Object.keys(codex).length > 0) frontmatter['codex'] = codex;

  const body =
    typeof parsed['developer_instructions'] === 'string' ? parsed['developer_instructions'] : '';

  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(
    destinationPath,
    `${serializeFrontmatter(frontmatter)}\n${body.trimEnd()}\n`,
    'utf8',
  );
}

async function importFile(originPath: string, destinationPath: string): Promise<void> {
  const raw = await readFile(originPath, 'utf8');
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, stripMarker(raw), 'utf8');
}

/**
 * Reverse-compile an installed item into the source tree. Refuses to
 * overwrite an existing source; throws when the origin does not exist. The
 * caller performs the adopt step (a forced sync of the imported item) so the
 * pre-existing targets gain markers and ledger entries.
 *
 * @returns The path of the created source.
 */
export async function importSource(
  request: ImportRequest,
  root: string,
  targets: Targets,
): Promise<string> {
  const tool = targets[request.from];

  if (request.kind === 'instructions') {
    const destination = join(root, INSTRUCTIONS_SOURCE_FILENAME);
    await refuseExisting(destination);
    if (!(await exists(tool.instructions))) {
      throw new Error(`no instructions file at ${tool.instructions}`);
    }
    await importFile(tool.instructions, destination);

    return destination;
  }

  const name = request.name;
  if (!name) throw new Error(`import ${request.kind} requires a <name>`);

  if (request.kind === 'skill') {
    const origin = join(tool.skills, name);
    const destination = join(root, 'skills', name);
    await refuseExisting(destination);
    if (!(await exists(join(origin, 'SKILL.md')))) {
      throw new Error(`no ${request.from} skill named \`${name}\` at ${origin}`);
    }

    if (request.from === 'claude') {
      await importClaudeSkill(origin, destination);
    } else {
      await importCodexSkill(origin, destination);
    }

    return join(destination, 'SKILL.md');
  }

  const originPath = join(tool.agents, request.from === 'claude' ? `${name}.md` : `${name}.toml`);
  const destination = join(root, 'agents', `${name}.md`);
  await refuseExisting(destination);
  if (!(await exists(originPath))) {
    throw new Error(`no ${request.from} agent named \`${name}\` at ${originPath}`);
  }

  if (request.from === 'claude') {
    await importFile(originPath, destination);
  } else {
    await importCodexAgent(originPath, destination);
  }

  return destination;
}
