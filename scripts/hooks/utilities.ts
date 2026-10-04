import { $ } from 'bun';
import { styleText } from 'node:util';

// Only Bun and Node built-ins here: hooks run in a fresh clone or worktree
// before `bun install` has, so a package import would crash every hook.

export const isContinuousIntegration = () =>
  process.env['CI'] === 'true' || process.env['CI'] === '1';

/** "post-checkout" → "Post Checkout". */
const titleCase = (text: string) =>
  text
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

export function header(title: string) {
  console.log('\n' + styleText(['bgBlue', 'black'], ` ${titleCase(title)} `));
}

export const info = (msg: string) => console.log(styleText('cyan', msg));
export const success = (msg: string) => console.log(styleText('green', msg));
export const warning = (msg: string) => console.log(styleText('yellow', msg));
export const error = (msg: string) => console.error(styleText('red', msg));

export async function getStagedFiles(): Promise<string[]> {
  const out = await $`git diff --cached --name-only`.text();
  return out.split('\n').filter(Boolean);
}

export async function fileChangedBetween(
  file: string,
  prev: string,
  next: string,
): Promise<boolean> {
  const out = await $`git diff --name-only ${prev}..${next} -- ${file}`.text();
  return out.trim().length > 0;
}

/** Install dependencies, reporting success or a non-fatal warning. */
export async function installDependencies(): Promise<void> {
  info('Dependencies changed, installing…');
  try {
    await $`bun install`.quiet();
    success('Dependencies installed');
  } catch {
    warning('Failed to install dependencies — run bun install manually');
  }
}
