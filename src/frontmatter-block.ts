import yaml from 'js-yaml';

/** A file split at its frontmatter fences, with the block parsed. */
export type FrontmatterBlock = {
  /** The parsed block: usually a mapping, but whatever the YAML holds. `{}` when it's empty. */
  data: unknown;
  /** Everything after the closing fence line. */
  body: string;
};

const OPENING_FENCE = '---';
const CLOSING_FENCE = '\n---';

/** Fence languages that would run code if a parser honored them. */
const EXECUTABLE_LANGUAGES = new Set(['js', 'javascript', 'coffee', 'coffeescript', 'cson']);

/**
 * Parse a block in the language its opening fence names. YAML is the default
 * and the only one either tool reads; JSON is accepted because it is valid
 * YAML's close cousin and earlier versions accepted it. Executable languages
 * are refused, never run.
 *
 * @throws {Error} For an executable or unknown language, or a block that does not parse.
 */
function parseBlock(language: string, block: string): unknown {
  switch (language.toLowerCase()) {
    case '':
    case 'yaml':
    case 'yml':
      return yaml.safeLoad(block);
    case 'json':
      return JSON.parse(block) as unknown;
    default:
      if (EXECUTABLE_LANGUAGES.has(language.toLowerCase())) {
        throw new Error('executable frontmatter is not allowed — use YAML');
      }
      throw new Error(`frontmatter language \`${language}\` is not supported — use YAML`);
  }
}

/**
 * Split a file into its frontmatter and body, the way gray-matter 4 does, so
 * results match the versions of this package that used it. Unlike gray-matter
 * it uses nothing from Node, so it runs in a browser.
 *
 * - The file must open with `---`. A fourth `-` means it isn't a fence, and the
 *   whole file is body with empty frontmatter.
 * - Text after the opening `---` on its line names the block's language.
 * - The block ends at the first line that starts with `---`. Without one, the
 *   rest of the file is frontmatter and the body is empty.
 * - A block holding only whitespace and `#` comment lines parses as `{}`.
 * - The body starts after the closing `---`, dropping one line break.
 *
 * @throws {Error} When the block names an unsupported language or does not parse.
 */
export function splitFrontmatterBlock(text: string): FrontmatterBlock {
  if (!text.startsWith(OPENING_FENCE)) return { data: {}, body: text };
  if (text.charAt(OPENING_FENCE.length) === '-') return { data: {}, body: text };

  let rest = text.slice(OPENING_FENCE.length);
  const lineEnd = rest.search(/\r?\n/);
  const languageLine = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
  const language = languageLine.trim();
  if (language) rest = rest.slice(languageLine.length);

  const closing = rest.indexOf(CLOSING_FENCE);
  const block = closing === -1 ? rest : rest.slice(0, closing);
  const blank = block.replace(/^\s*#[^\n]+/gm, '').trim() === '';
  const data = blank ? {} : parseBlock(language, block);

  if (closing === -1) return { data, body: '' };

  let body = rest.slice(closing + CLOSING_FENCE.length);
  if (body.startsWith('\r')) body = body.slice(1);
  if (body.startsWith('\n')) body = body.slice(1);

  return { data, body };
}
