#!/usr/bin/env bun
import chalk from 'chalk';
import { $ } from 'bun';
import packageDefinition from '../package.json' with { type: 'json' };

/**
 * Everything that makes `npm publish` fail — or silently ship something
 * broken — that can be known *before* the registry is contacted.
 *
 * These checks exist because each one has actually cost a release: a scoped
 * package rejected with `E402 Payment Required`, a `bin` entry silently
 * stripped because its path began with `./`, a version republished and
 * refused. `npm publish --dry-run` catches none of them: it never performs
 * the registry `PUT`, so authentication, access level, and version conflicts
 * are all invisible to it.
 *
 * Runs first in `prepublishOnly` so it fails in a second rather than after
 * the full gate.
 */

type Problem = { level: 'error' | 'warning'; message: string };

const problems: Problem[] = [];
const fail = (message: string) => problems.push({ level: 'error', message });
const warn = (message: string) => problems.push({ level: 'warning', message });

const definition = packageDefinition as Record<string, unknown>;
const name = typeof definition['name'] === 'string' ? definition['name'] : '';
const version = typeof definition['version'] === 'string' ? definition['version'] : '';
const isContinuousIntegration = Boolean(Bun.env['CI'] ?? Bun.env['GITHUB_ACTIONS']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

// `private: true` makes npm refuse outright.
if (definition['private'] === true) {
  fail('`private: true` blocks publishing. Remove it, or do not publish this package.');
}

// Scoped packages default to restricted access; npm answers a publish attempt
// with `402 Payment Required - You must sign up for private packages`, which
// reads like a billing problem rather than a missing config field.
const publishConfig = record(definition['publishConfig']);
if (name.startsWith('@') && publishConfig['access'] !== 'public') {
  fail(
    `\`${name}\` is scoped, so npm treats it as private and rejects publishing with ` +
      '`E402 Payment Required — You must sign up for private packages`.\n' +
      '    Fix: add `"publishConfig": { "access": "public" }` to package.json.\n' +
      '    (Keep provenance out of publishConfig — it only works from CI and would break local publishes.)',
  );
}

// npm 11 rejects bin paths beginning with `./`, drops the entry, and only
// warns — so the package publishes successfully with no working binary.
for (const [binaryName, binaryPath] of Object.entries(record(definition['bin']))) {
  if (typeof binaryPath === 'string' && binaryPath.startsWith('./')) {
    fail(
      `bin["${binaryName}"] is "${binaryPath}". npm strips paths beginning with "./" and the ` +
        'published package will have no working binary.\n' +
        `    Fix: write it bare — "${binaryPath.slice(2)}".`,
    );
  }
}

// A published package with no description is a bare page on npm.
if (!isNonEmptyString(definition['description'])) {
  fail('`description` is empty. It is the one line shown on the npm page and in search results.');
}

for (const field of ['repository', 'homepage', 'bugs']) {
  if (definition[field] === undefined) {
    warn(`\`${field}\` is not set. Nothing enforces it, but its absence shows on the npm page.`);
  }
}

// Republishing an existing version is refused. Checking first turns a failure
// at the very end of a release into a message before anything runs.
if (name && version) {
  const published = await $`npm view ${`${name}@${version}`} version`.nothrow().quiet();
  if (published.exitCode === 0 && published.stdout.toString().trim() === version) {
    fail(
      `${name}@${version} is already published. npm refuses to replace a published version.\n` +
        '    Fix: bump the version (a botched release means a new version, not a retry).',
    );
  } else if (published.exitCode !== 0 && !published.stderr.toString().includes('E404')) {
    warn('Could not reach the registry to check whether this version already exists.');
  }
}

// In CI the release workflow authenticates with OIDC trusted publishing, where
// there is no logged-in user and `npm whoami` legitimately fails.
if (!isContinuousIntegration) {
  const whoami = await $`npm whoami`.nothrow().quiet();
  if (whoami.exitCode === 0) {
    // With two-factor auth set to "auth and writes", every publish needs a
    // one-time password. npm prompts for it interactively, but a publish run
    // through a pipe or a script fails with `EOTP` instead.
    const profile = await $`npm profile get --json`.nothrow().quiet();
    if (profile.exitCode === 0 && profile.stdout.toString().includes('"auth-and-writes"')) {
      warn(
        'npm two-factor auth is set to "auth and writes", so this publish needs a one-time password.\n' +
          '    Interactively npm will prompt for it; otherwise pass `npm publish --otp=<code>`.',
      );
    }
  } else {
    fail('Not logged in to npm (`npm whoami` failed). Run `npm login` first.');
  }
}

const errors = problems.filter((problem) => problem.level === 'error');
const warnings = problems.filter((problem) => problem.level === 'warning');

for (const { message } of warnings) console.warn(`${chalk.yellow('warning')} ${message}`);
for (const { message } of errors) console.error(`${chalk.red('error')} ${message}`);

if (errors.length > 0) {
  console.error(
    `\n${chalk.red(`Publish preflight found ${errors.length} blocking problem(s).`)} ` +
      'Fixing these now avoids burning a release attempt.',
  );
  process.exit(1);
}

console.log(chalk.green(`✓ publish preflight passed for ${name}@${version}`));
