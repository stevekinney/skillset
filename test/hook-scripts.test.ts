import { describe, expect, it } from 'bun:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hooksDirectory = join(import.meta.dir, '..', 'scripts', 'hooks');
const hookScripts = [...new Bun.Glob('*.ts').scanSync(hooksDirectory)].filter(
  (file) => !file.endsWith('.test.ts'),
);

// Git hooks run before `bun install` has: a fresh clone or a new worktree has no
// node_modules, and post-checkout is the hook that would install them.
describe('git hook scripts', () => {
  it.each(hookScripts)('%s imports only Bun, Node, and sibling modules', async (file) => {
    // The transpiler rejects a shebang, which every hook starts with.
    const text = await Bun.file(join(hooksDirectory, file)).text();
    const source = text.replace(/^#!.*/, '');
    const imports = new Bun.Transpiler({ loader: 'ts' }).scanImports(source);
    expect(imports.length).toBeGreaterThan(0);
    for (const { path } of imports) {
      expect(path === 'bun' || path.startsWith('node:') || path.startsWith('./')).toBe(true);
    }
  });

  it('runs post-checkout without node_modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillset-hooks-'));
    try {
      await cp(hooksDirectory, directory, { recursive: true });
      const hook = Bun.spawn(
        ['bun', '--no-install', 'post-checkout.ts', '0'.repeat(40), 'HEAD', '1'],
        { cwd: directory, env: { ...process.env, CI: '' }, stderr: 'pipe', stdout: 'pipe' },
      );
      expect(await hook.exited).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
