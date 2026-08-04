/**
 * Line-level TOML section splicing. Used to edit `~/.codex/config.toml`
 * without a parse/re-serialize round trip, so comments and formatting outside
 * the touched `[mcp_servers.<name>]` sections survive byte-for-byte.
 */

const HEADER_PATTERN = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/;

/** Normalize a header's dotted key, stripping optional quotes per segment. */
function headerName(line: string): string | undefined {
  const match = HEADER_PATTERN.exec(line);
  if (!match) return undefined;

  return match[1]!
    .split('.')
    .map((segment) => segment.trim().replace(/^["']|["']$/g, ''))
    .join('.');
}

function belongsToSection(name: string, section: string): boolean {
  return name === section || name.startsWith(`${section}.`);
}

type Span = { start: number; end: number };

/** Find every line span belonging to `section` (including its subsections). */
function sectionSpans(lines: string[], section: string): Span[] {
  const spans: Span[] = [];
  let current: Span | undefined;

  for (const [index, line] of lines.entries()) {
    const name = headerName(line);
    if (name === undefined) continue;

    if (current) {
      current.end = index;
      spans.push(current);
      current = undefined;
    }
    if (belongsToSection(name, section)) {
      current = { start: index, end: lines.length };
    }
  }

  if (current) spans.push(current);

  return spans;
}

/**
 * Replace (or delete, when `replacement` is undefined) every line span of
 * `section` and its subsections. The replacement is inserted at the position
 * of the first existing span, or appended at the end when the section does
 * not exist yet. All other lines are untouched.
 */
export function spliceTomlSection(
  contents: string,
  section: string,
  replacement: string | undefined,
): string {
  const lines = contents.split('\n');
  const spans = sectionSpans(lines, section);
  const replacementLines = replacement === undefined ? [] : replacement.trimEnd().split('\n');

  if (spans.length === 0) {
    return replacementLines.length === 0 ? contents : appendSection(lines, replacementLines);
  }

  return replaceSpans(lines, spans, replacementLines);
}

function appendSection(lines: string[], replacementLines: string[]): string {
  const output = [...lines];
  while (output.length > 0 && output.at(-1) === '') output.pop();
  if (output.length > 0) output.push('');

  return [...output, ...replacementLines, ''].join('\n');
}

/**
 * Replace, insert, or (with `undefined`) delete one top-level scalar
 * assignment (`key = value`) in the region before the first table header.
 * `value` must already be a serialized TOML value (e.g. `"gpt-5.6"`). All
 * other lines are untouched.
 */
export function spliceTomlScalar(contents: string, key: string, value: string | undefined): string {
  const lines = contents.split('\n');
  const firstHeader = lines.findIndex((line) => headerName(line) !== undefined);
  const topEnd = firstHeader === -1 ? lines.length : firstHeader;
  const assignment = new RegExp(String.raw`^\s*${key}\s*=`);
  const existing = lines.slice(0, topEnd).findIndex((line) => assignment.test(line));

  if (existing !== -1) {
    const output = [...lines];
    if (value === undefined) {
      output.splice(existing, 1);
    } else {
      output[existing] = `${key} = ${value}`;
    }

    return output.join('\n');
  }

  if (value === undefined) return contents;

  const output = [...lines];
  let insertAt = topEnd;
  while (insertAt > 0 && output[insertAt - 1] === '') insertAt -= 1;
  output.splice(insertAt, 0, `${key} = ${value}`);

  return output.join('\n');
}

function replaceSpans(lines: string[], spans: Span[], replacementLines: string[]): string {
  const excluded = new Set<number>();
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) excluded.add(index);
  }

  const output: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index === spans[0]!.start && replacementLines.length > 0) {
      output.push(...replacementLines);
    }
    if (!excluded.has(index)) output.push(line);
  }

  return output.join('\n');
}
