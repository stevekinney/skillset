import { describe, expect, it } from 'bun:test';

import {
  checkDefaultsSource,
  claudeDefaultEntries,
  codexDefaultEntries,
  parseDefaultsSource,
} from './defaults-config.js';

const raw = `claude:
  model: opus
  effort: high
codex:
  model: gpt-5.6-sol
  model_reasoning_effort: high
  model_verbosity: medium
`;

describe('parseDefaultsSource', () => {
  it('parses and validates', () => {
    const source = parseDefaultsSource(raw);
    expect(source.claude?.model).toBe('opus');
    expect(source.codex?.model_verbosity).toBe('medium');
  });

  it('rejects non-mappings and invalid efforts', () => {
    expect(() => parseDefaultsSource('- a\n')).toThrow('YAML mapping');
    expect(() => parseDefaultsSource('claude:\n  effort: extreme\n')).toThrow();
  });
});

describe('entries', () => {
  it('maps claude fields onto settings.json keys', () => {
    expect(claudeDefaultEntries(parseDefaultsSource(raw))).toEqual({
      model: 'opus',
      effortLevel: 'high',
    });
    expect(claudeDefaultEntries(parseDefaultsSource('codex:\n  model: x\n'))).toEqual({});
  });

  it('maps codex fields onto config.toml scalars', () => {
    expect(codexDefaultEntries(parseDefaultsSource(raw))).toEqual({
      model: 'gpt-5.6-sol',
      model_reasoning_effort: 'high',
      model_verbosity: 'medium',
    });
    expect(codexDefaultEntries(parseDefaultsSource('claude:\n  model: x\n'))).toEqual({});
  });
});

describe('checkDefaultsSource', () => {
  it('warns when both blocks are absent', () => {
    expect(checkDefaultsSource(parseDefaultsSource('{}\n'))[0]?.message).toContain(
      'neither a `claude` nor a `codex` block',
    );
    expect(checkDefaultsSource(parseDefaultsSource(raw))).toEqual([]);
  });
});
