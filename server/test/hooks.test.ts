import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = join(import.meta.dirname, '../../scripts/hooks');
const hooks = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../hooks/hooks.json'), 'utf8'),
) as {
  hooks: Record<string, { matcher?: string }[]>;
};

function run(
  script: string,
  input: unknown,
  env: Record<string, string> = {},
): { stdout: string; status: number | null } {
  const result = spawnSync(process.execPath, [join(scripts, script)], {
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: result.stdout, status: result.status };
}

describe('guard-runner (PreToolUse)', () => {
  const matcher = new RegExp(hooks.hooks['PreToolUse']?.[0]?.matcher ?? '');

  it('matches risky tools but never the PersonaQA browser tools', () => {
    for (const tool of [
      'Bash',
      'Read',
      'WebFetch',
      'mcp__playwright__browser_navigate',
      'mcp__fetch__fetch',
    ]) {
      expect(matcher.test(tool)).toBe(true);
    }
    expect(matcher.test('mcp__plugin_personaqa_browser__tap')).toBe(false);
    expect(matcher.test('TodoWrite')).toBe(false);
  });

  it('denies other tools inside a persona runner', () => {
    const { stdout } = run('guard-runner.mjs', {
      agent_type: 'personaqa:persona-runner',
      tool_name: 'mcp__playwright__browser_navigate',
    });
    const decision = JSON.parse(stdout) as { hookSpecificOutput: Record<string, string> };

    expect(decision.hookSpecificOutput['permissionDecision']).toBe('deny');
    expect(decision.hookSpecificOutput['permissionDecisionReason']).toContain('black box');
  });

  it('stays out of the way everywhere else', () => {
    expect(run('guard-runner.mjs', { tool_name: 'Bash' }).stdout).toBe('');
    expect(run('guard-runner.mjs', { agent_type: 'Explore', tool_name: 'Read' }).stdout).toBe('');
    expect(
      run('guard-runner.mjs', {
        agent_type: 'persona-runner',
        tool_name: 'mcp__plugin_personaqa_browser__look',
      }).stdout,
    ).toBe('');
  });
});

describe('log-tool (PostToolUse)', () => {
  it('appends browser tool calls to tool-calls.jsonl in projects that use PersonaQA', () => {
    const project = mkdtempSync(join(tmpdir(), 'personaqa-hooks-'));
    mkdirSync(join(project, '.personaqa'));

    run(
      'log-tool.mjs',
      {
        agent_type: 'personaqa:persona-runner',
        tool_name: 'mcp__plugin_personaqa_browser__type',
        tool_input: { session: 'james--checkout--ab12', ref: 'e9', text: 'x'.repeat(400) },
        tool_response: { isError: true },
        duration_ms: 120,
      },
      { CLAUDE_PROJECT_DIR: project },
    );

    const entry = JSON.parse(
      readFileSync(join(project, '.personaqa/runs/tool-calls.jsonl'), 'utf8').trim(),
    ) as Record<string, unknown>;
    expect(entry).toMatchObject({
      agent: 'personaqa:persona-runner',
      tool: 'type',
      session: 'james--checkout--ab12',
      duration_ms: 120,
      error: true,
    });
    expect(String((entry['args'] as Record<string, unknown>)['text']).length).toBe(301);
  });

  it('does nothing in projects without .personaqa', () => {
    const project = mkdtempSync(join(tmpdir(), 'personaqa-hooks-'));
    expect(
      run(
        'log-tool.mjs',
        { tool_name: 'mcp__plugin_personaqa_browser__look' },
        { CLAUDE_PROJECT_DIR: project },
      ).status,
    ).toBe(0);
  });
});

describe('require-finish (SubagentStop)', () => {
  function transcript(...blocks: object[]): string {
    const file = join(mkdtempSync(join(tmpdir(), 'personaqa-transcript-')), 'agent.jsonl');
    writeFileSync(
      file,
      blocks.map((content) => JSON.stringify({ message: { content: [content] } })).join('\n'),
    );
    return file;
  }

  const start = {
    type: 'tool_use',
    id: 't1',
    name: 'mcp__plugin_personaqa_browser__start_session',
  };
  const finish = { type: 'tool_use', id: 't2', name: 'mcp__plugin_personaqa_browser__finish' };

  it('keeps a runner going when it started a session but never finished', () => {
    const { stdout } = run('require-finish.mjs', {
      agent_type: 'personaqa:persona-runner',
      agent_transcript_path: transcript(start),
    });

    expect(JSON.parse(stdout)).toMatchObject({ decision: 'block' });
  });

  it('lets the runner stop after finish, after a failed start, or on the second attempt', () => {
    const runner = { agent_type: 'personaqa:persona-runner' };
    expect(
      run('require-finish.mjs', { ...runner, agent_transcript_path: transcript(start, finish) })
        .stdout,
    ).toBe('');
    expect(
      run('require-finish.mjs', {
        ...runner,
        agent_transcript_path: transcript(start, {
          type: 'tool_result',
          tool_use_id: 't1',
          is_error: true,
        }),
      }).stdout,
    ).toBe('');
    expect(
      run('require-finish.mjs', {
        ...runner,
        stop_hook_active: true,
        agent_transcript_path: transcript(start),
      }).stdout,
    ).toBe('');
    expect(
      run('require-finish.mjs', { agent_type: 'Explore', agent_transcript_path: transcript(start) })
        .stdout,
    ).toBe('');
  });
});
