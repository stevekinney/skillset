import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CliDependencies } from '../src/cli.js';

/**
 * A temporary source root and home directory for running the CLI in tests.
 * Each test file registers `removeFixtures` with its own `afterEach`.
 */
const temporaryDirectories: string[] = [];

export async function removeFixtures(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

/** Whether anything exists at `path`, file or directory (unlike `Bun.file().exists()`). */
export async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

export type Fixture = {
  dependencies: CliDependencies;
  lines: string[];
  root: string;
  home: string;
};

export async function makeFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), 'skillset-cli-'));
  temporaryDirectories.push(base);

  const home = join(base, 'home');
  await mkdir(join(base, 'skills'), { recursive: true });
  await mkdir(home, { recursive: true });

  const lines: string[] = [];

  return {
    root: base,
    home,
    lines,
    dependencies: {
      cwd: base,
      env: { NODE_ENV: 'test' },
      homeDirectory: home,
      log: (line) => lines.push(line),
    },
  };
}

export async function addSkill(fixture: Fixture, name: string, raw: string): Promise<void> {
  await mkdir(join(fixture.root, 'skills', name), { recursive: true });
  await writeFile(join(fixture.root, 'skills', name, 'SKILL.md'), raw);
}

export async function addAgent(fixture: Fixture, name: string, raw: string): Promise<void> {
  await mkdir(join(fixture.root, 'agents'), { recursive: true });
  await writeFile(join(fixture.root, 'agents', `${name}.md`), raw);
}

export const validSkill = '---\nname: demo\ndescription: A demo.\n---\n\nBody.\n';
export const invalidSkill = '---\nname: Bad Name\ndescription: A demo.\n---\n\nBody.\n';
export const validAgent = '---\nname: reviewer\ndescription: Reviews.\n---\n\nYou review.\n';
