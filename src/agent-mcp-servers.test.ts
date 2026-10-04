import { describe, expect, it } from 'bun:test';

import { claudeAgentMcpItemProblems, claudeAgentMcpServerSchema } from './agent-mcp-servers.js';

describe('claudeAgentMcpServerSchema', () => {
  it('accepts a server name or a one-key inline entry', () => {
    expect(claudeAgentMcpServerSchema.parse('github')).toBe('github');
    const inline = { playwright: { type: 'stdio', command: 'npx', args: ['-y', 'x'] } };
    expect(claudeAgentMcpServerSchema.parse(inline) as unknown).toEqual(inline);
  });

  it('requires exactly one server name in an inline mapping', () => {
    expect(claudeAgentMcpServerSchema.safeParse({}).success).toBe(false);
    const two = { a: { command: 'x' }, b: { command: 'y' } };
    expect(claudeAgentMcpServerSchema.safeParse(two).success).toBe(false);
  });

  it('rejects what Claude Code would drop', () => {
    expect(claudeAgentMcpServerSchema.safeParse({ a: { type: 'http' } }).success).toBe(false);
    expect(claudeAgentMcpServerSchema.safeParse(5).success).toBe(false);
  });

  it('reports why Claude Code would drop an item', () => {
    expect(claudeAgentMcpItemProblems({ a: { type: 'http' } })[0]?.path).toEqual(['a', 'url']);
    expect(claudeAgentMcpItemProblems([]).length).toBe(1);
    expect(claudeAgentMcpItemProblems({ a: { type: 'sdk' } }).length).toBe(1);
  });
});

const texts = (item: unknown) =>
  claudeAgentMcpItemProblems(item).map((problem) => [...problem.path, problem.message].join(': '));

describe('claudeAgentMcpItemProblems', () => {
  it('accepts names and valid inline entries', () => {
    expect(claudeAgentMcpItemProblems('github')).toEqual([]);
    expect(claudeAgentMcpItemProblems({ a: { command: 'x' } })).toEqual([]);
  });

  it('reports non-name, non-mapping items and non-mapping entries', () => {
    expect(texts(5)[0]).toContain('expected a server name');
    expect(texts({ a: 5 })).toEqual(['a: expected a server entry']);
  });

  it('reports invalid and unknown-type entries', () => {
    expect(texts({ a: { type: 'http' } })[0]).toStartWith('a: url:');
    expect(texts({ a: { type: 'mystery' } })[0]).toContain('unknown type `mystery`');
  });

  it('accepts claudeai-proxy but warns it is not user-authored', () => {
    const complete = texts({ a: { type: 'claudeai-proxy', url: 'x', id: 'y' } });
    expect(complete).toHaveLength(1);
    expect(complete[0]).toContain('not a user-authored transport');
    expect(texts({ a: { type: 'claudeai-proxy' } }).length).toBe(3);
  });
});
