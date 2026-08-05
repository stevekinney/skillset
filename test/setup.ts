import { afterEach, mock, setSystemTime } from 'bun:test';
import chalk from 'chalk';

// Sentinel so tests can assert the preload actually ran.
(globalThis as Record<string, unknown>)['__BUN_TEST_SETUP_LOADED__'] = true;

// Chalk decides whether to emit ANSI codes from the *test runner's* stdout:
// coloured in a terminal, plain when piped to a file or a CI log. Without
// pinning it, every in-process assertion on rendered output would pass or fail
// depending on how the suite was invoked — green when piped, red under a real
// TTY (which is how `npm publish` runs `prepublishOnly`). Force it off so those
// tests assert on content only. Colour behaviour itself is covered end-to-end
// by the NO_COLOR/FORCE_COLOR tests, which spawn their own subprocess and are
// unaffected by this setting.
chalk.level = 0;

afterEach(() => {
  mock.restore();
  setSystemTime();
});
