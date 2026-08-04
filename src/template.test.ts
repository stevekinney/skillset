import { describe, expect, it } from 'bun:test';

import { renderConditionals } from './template.js';

describe('renderConditionals', () => {
  it('passes bodies without directives through untouched', () => {
    const result = renderConditionals('one\ntwo', 'claude');
    expect(result.body).toBe('one\ntwo');
    expect(result.errors).toEqual([]);
  });

  it('keeps a matching #if block and drops the directive lines', () => {
    const body = 'a\n<!-- #if claude -->\nb\n<!-- #endif -->\nc';
    expect(renderConditionals(body, 'claude').body).toBe('a\nb\nc');
    expect(renderConditionals(body, 'codex').body).toBe('a\nc');
  });

  it('honors #else', () => {
    const body = '<!-- #if claude -->\nclaude-only\n<!-- #else -->\ncodex-only\n<!-- #endif -->';
    expect(renderConditionals(body, 'claude').body).toBe('claude-only');
    expect(renderConditionals(body, 'codex').body).toBe('codex-only');
  });

  it('supports nesting', () => {
    const body = [
      '<!-- #if claude -->',
      'outer',
      '<!-- #if codex -->',
      'never',
      '<!-- #endif -->',
      '<!-- #endif -->',
    ].join('\n');
    expect(renderConditionals(body, 'claude').body).toBe('outer');
    expect(renderConditionals(body, 'codex').body).toBe('');
  });

  it('allows indented directives', () => {
    const body = '  <!-- #if codex -->\nkept\n  <!-- #endif -->';
    expect(renderConditionals(body, 'codex').body).toBe('kept');
  });

  it('reports an unknown #if target', () => {
    const result = renderConditionals('<!-- #if cursor -->\nx\n<!-- #endif -->', 'claude');
    expect(result.errors).toEqual([
      { line: 1, message: '#if expects `claude` or `codex`, got `cursor`' },
    ]);
  });

  it('reports an unknown directive keyword', () => {
    const result = renderConditionals('<!-- #unless claude -->', 'claude');
    expect(result.errors[0]?.message).toBe('unknown directive `#unless`');
  });

  it('reports arguments on #else and #endif', () => {
    const body = '<!-- #if claude -->\n<!-- #else now -->\n<!-- #endif now -->\n<!-- #endif -->';
    const messages = renderConditionals(body, 'claude').errors.map((error) => error.message);
    expect(messages).toEqual(['#else takes no argument', '#endif takes no argument']);
  });

  it('reports #else and #endif without a matching #if', () => {
    const result = renderConditionals('<!-- #else -->\n<!-- #endif -->', 'claude');
    expect(result.errors.map((error) => error.message)).toEqual([
      '#else without a matching #if',
      '#endif without a matching #if',
    ]);
  });

  it('reports a duplicate #else', () => {
    const body = '<!-- #if claude -->\n<!-- #else -->\n<!-- #else -->\n<!-- #endif -->';
    expect(renderConditionals(body, 'claude').errors[0]?.message).toBe(
      'duplicate #else in the same #if block',
    );
  });

  it('reports an unclosed #if with its opening line', () => {
    const result = renderConditionals('text\n<!-- #if codex -->\nx', 'claude');
    expect(result.errors).toEqual([{ line: 2, message: '#if without a matching #endif' }]);
  });
});
