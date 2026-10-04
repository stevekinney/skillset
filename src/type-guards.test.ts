import { describe, expect, it } from 'bun:test';

import {
  isAgentFrontmatter,
  isClaudeAgentMcpServer,
  isClaudeEffort,
  isClaudeHookInput,
  isClaudeHookInputFor,
  isClaudeHookOutput,
  isClaudeHookSettings,
  isClaudeMcpOverride,
  isClaudeMcpServer,
  isClaudeSettingsEffort,
  isCodexHookInput,
  isCodexHookInputFor,
  isCodexHookOutputFor,
  isCodexHookSettings,
  isCodexMcpFields,
  isCodexMcpServer,
  isCodexSkills,
  isCodexTools,
  isDefaultsSource,
  isHooksSource,
  isMcpSource,
  isOpenaiConfiguration,
  isSkillFrontmatter,
} from './type-guards.js';

const claudeStopInput = {
  hook_event_name: 'Stop',
  session_id: 's',
  transcript_path: '/t.jsonl',
  cwd: '/repository',
  stop_hook_active: false,
};

const codexStopInput = {
  hook_event_name: 'Stop',
  session_id: 's',
  transcript_path: null,
  cwd: '/repository',
  model: 'gpt-5',
  turn_id: 't',
  permission_mode: 'default',
  stop_hook_active: false,
  last_assistant_message: null,
};

describe('configuration guards', () => {
  const cases: [string, (value: unknown) => boolean, unknown, unknown][] = [
    ['isSkillFrontmatter', isSkillFrontmatter, { name: 'a', description: 'b' }, { name: 'a' }],
    ['isAgentFrontmatter', isAgentFrontmatter, { name: 'a', description: 'b' }, { name: 1 }],
    ['isHooksSource', isHooksSource, { hooks: { Stop: [{ command: 'x' }] } }, { hooks: 1 }],
    ['isMcpSource', isMcpSource, { servers: { a: { command: 'x' } } }, { servers: [] }],
    [
      'isDefaultsSource',
      isDefaultsSource,
      { claude: { effort: 'high' } },
      { claude: { effort: 'max' } },
    ],
    [
      'isClaudeHookSettings',
      isClaudeHookSettings,
      { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
      { OnSneeze: [] },
    ],
    [
      'isCodexHookSettings',
      isCodexHookSettings,
      { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
      { Stop: 'x' },
    ],
    ['isClaudeMcpServer', isClaudeMcpServer, { command: 'npx' }, { type: 'http' }],
    ['isClaudeMcpOverride', isClaudeMcpOverride, { headersHelper: 'x' }, { timeout: 'soon' }],
    ['isCodexMcpFields', isCodexMcpFields, { startup_timeout_sec: 20 }, { enabled: 'yes' }],
    [
      'isCodexMcpServer',
      isCodexMcpServer,
      { command: 'npx' },
      { command: 'npx', url: 'https://x' },
    ],
    ['isClaudeAgentMcpServer', isClaudeAgentMcpServer, 'github', 5],
    [
      'isCodexSkills',
      isCodexSkills,
      { include_instructions: false },
      { include_instructions: 'no' },
    ],
    ['isCodexTools', isCodexTools, { update_plan: { enabled: true } }, { update_plan: 'on' }],
    [
      'isOpenaiConfiguration',
      isOpenaiConfiguration,
      { policy: { allow_implicit_invocation: false } },
      { policy: { products: ['slack'] } },
    ],
    ['isClaudeEffort', isClaudeEffort, 8000, 'extreme'],
    ['isClaudeSettingsEffort', isClaudeSettingsEffort, 'xhigh', 'max'],
  ];

  for (const [name, guard, valid, invalid] of cases) {
    it(`${name} accepts a valid value and rejects an invalid one`, () => {
      expect(guard(valid)).toBe(true);
      expect(guard(invalid)).toBe(false);
    });
  }

  it('narrows to the input type, so values the schema converts are still typed honestly', () => {
    const value: unknown = { name: 'a', description: 'b', 'disable-model-invocation': 'yes' };
    if (!isSkillFrontmatter(value)) throw new Error('expected a skill frontmatter input');
    expect(value['disable-model-invocation']).toBe('yes');
  });
});

describe('hook payload guards', () => {
  it('checks Claude inputs, in general and for one event', () => {
    expect(isClaudeHookInput(claudeStopInput)).toBe(true);
    expect(isClaudeHookInput({ hook_event_name: 'Stop' })).toBe(false);
    expect(isClaudeHookInputFor('Stop', claudeStopInput)).toBe(true);
    expect(isClaudeHookInputFor('SessionEnd', claudeStopInput)).toBe(false);

    const value: unknown = claudeStopInput;
    if (!isClaudeHookInputFor('Stop', value)) throw new Error('expected a Stop input');
    const active: boolean = value.stop_hook_active;
    expect(active).toBe(false);
  });

  it('checks Claude outputs, including the async form', () => {
    expect(isClaudeHookOutput({ decision: 'block', reason: 'r' })).toBe(true);
    expect(isClaudeHookOutput({ async: true })).toBe(true);
    expect(isClaudeHookOutput({ continue: 'yes' })).toBe(false);
  });

  it('checks Codex inputs and outputs', () => {
    expect(isCodexHookInput(codexStopInput)).toBe(true);
    expect(isCodexHookInput({ hook_event_name: 'Stop' })).toBe(false);
    expect(isCodexHookInputFor('Stop', codexStopInput)).toBe(true);
    expect(isCodexHookInputFor('Interrupt', codexStopInput)).toBe(false);

    expect(isCodexHookOutputFor('Stop', { decision: 'block', reason: 'again' })).toBe(true);
    expect(isCodexHookOutputFor('PreToolUse', { suppressOutput: true })).toBe(false);

    const output: unknown = { decision: 'block', reason: 'again' };
    if (!isCodexHookOutputFor('Stop', output)) throw new Error('expected a Stop output');
    const decision: 'block' | undefined = output.decision;
    expect(decision).toBe('block');
  });
});
