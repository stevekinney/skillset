import { describe, expect, it } from 'bun:test';
import matter from 'gray-matter';

import { splitFrontmatterBlock } from './frontmatter-block.js';

function refuseExecutableFrontmatter(): never {
  throw new Error('executable frontmatter is not allowed — use YAML');
}

/** How this package split a file before it dropped gray-matter. */
function grayMatterSplit(text: string): { data: unknown; body: string } {
  const file = matter(text, {
    engines: {
      js: refuseExecutableFrontmatter,
      javascript: refuseExecutableFrontmatter,
      coffee: refuseExecutableFrontmatter,
      coffeescript: refuseExecutableFrontmatter,
      cson: refuseExecutableFrontmatter,
    },
  });

  return { data: file.data, body: file.content };
}

function outcome(split: (text: string) => { data: unknown; body: string }, text: string): unknown {
  try {
    return split(text);
  } catch {
    return 'throws';
  }
}

const cases: Record<string, string> = {
  'a plain block': '---\nname: a\ndescription: Does a thing.\n---\nBody.\n',
  'a blank line before the body': '---\nname: a\n---\n\nBody.\n',
  'Windows line endings': '---\r\nname: a\r\n---\r\nBody.\r\n',
  'an empty block': '---\n---\nBody.',
  'a block of only comments': '---\n# only a comment\n  # and another\n---\nBody.',
  'a comment above a key': '---\n# the folder name\nname: a\n---\n',
  'no closing fence': '---\nname: a\ndescription: b\n',
  'a fourth dash': '----\nname: a\n---\nBody.',
  'a yaml fence': '---yaml\nname: a\n---\nBody.',
  'a yml fence': '---yml\nname: a\n---\nBody.',
  'a json fence': '---json\n{ "name": "a" }\n---\nBody.',
  'spaces after the fences': '---   \nname: a\n---  \nBody.',
  'a closing fence with more on its line': '---\nname: a\n---more\nBody.',
  'YAML 1.1 lookalikes': '---\nflag: yes\nother: on\noctal: 012\nwhen: 2024-01-01\n---\n',
  'a block scalar': '---\ndescription: |\n  Line one.\n  Line two.\n---\nBody.',
  'a dash inside the block': '---\nname: a\nnote: "---"\n---\nBody.',
  'a sequence instead of a mapping': '---\n- one\n- two\n---\n',
  'duplicate keys': '---\nname: a\nname: b\n---\n',
  'malformed YAML': '---\nname: [unterminated\n---\n',
  'an executable fence': '---js\n{ name: "x" }\n---\nBody.',
  'a coffee fence': '---coffee\nname: "x"\n---\nBody.',
};

describe('splitFrontmatterBlock', () => {
  for (const [name, text] of Object.entries(cases)) {
    it(`matches gray-matter for ${name}`, () => {
      expect(outcome(splitFrontmatterBlock, text)).toEqual(outcome(grayMatterSplit, text));
    });
  }

  it('reads a file that does not open with a fence as all body', () => {
    expect(splitFrontmatterBlock('# Title\n')).toEqual({ data: {}, body: '# Title\n' });
  });

  it('refuses executable fences with a clear message', () => {
    expect(() => splitFrontmatterBlock('---javascript\n{}\n---\n')).toThrow(
      'executable frontmatter is not allowed — use YAML',
    );
  });

  it('names an unsupported fence language', () => {
    expect(() => splitFrontmatterBlock('---toml\nname = "a"\n---\n')).toThrow(
      'frontmatter language `toml` is not supported — use YAML',
    );
  });

  it('runs without Node’s Buffer, as in a browser', () => {
    const globals = globalThis as { Buffer?: unknown };
    const buffer = globals.Buffer;
    delete globals.Buffer;

    try {
      expect(splitFrontmatterBlock('---\nname: a\n---\nBody.\n')).toEqual({
        data: { name: 'a' },
        body: 'Body.\n',
      });
    } finally {
      globals.Buffer = buffer;
    }
  });
});
