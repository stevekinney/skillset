import { describe, expect, it, spyOn } from 'bun:test';

describe('bin', () => {
  it('runs the CLI against process.argv and records the exit code', async () => {
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = ['bun', 'bin.ts', '--help'];

    try {
      await import('./bin.js');
      expect(process.exitCode).toBe(0);
      expect(write.mock.calls.flat().join('')).toContain('Usage:');
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      write.mockRestore();
    }
  });
});
