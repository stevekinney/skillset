/**
 * Errors Windows raises while another process briefly holds a file open: a
 * virus scanner or search indexer inspecting a file just written, or a tool
 * (Claude Code rewrites `.claude.json` often) writing the same config.
 */
const windowsLockCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * How long to wait before each retry, in milliseconds: about 1.5 seconds in
 * all. Those locks last from milliseconds to around a second, so a longer wait
 * would only delay reporting a lock that isn't going away.
 */
const retryWaits = [50, 100, 200, 400, 800];

function isWindowsLock(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;

  return typeof cause.code === 'string' && windowsLockCodes.has(cause.code);
}

export type RetryOptions = {
  /** The OS to behave as; defaults to the running one. */
  platform?: string;
  /** How to wait between attempts; injectable so tests don't sleep. */
  wait?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Run a file operation, retrying it with a short backoff when Windows reports
 * that another process has the file locked. Anywhere else, and for any other
 * error, it fails at once: on macOS, Linux, and WSL these codes are real
 * permission errors that retrying would only delay.
 */
export async function retryOnWindowsLock<Result>(
  operation: () => Promise<Result>,
  options: RetryOptions = {},
): Promise<Result> {
  const platform = options.platform ?? process.platform;
  const wait = options.wait ?? sleep;

  for (const milliseconds of retryWaits) {
    try {
      return await operation();
    } catch (cause) {
      if (platform !== 'win32' || !isWindowsLock(cause)) throw cause;
      await wait(milliseconds);
    }
  }

  return operation();
}
