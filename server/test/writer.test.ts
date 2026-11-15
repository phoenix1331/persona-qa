import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newRunId, runDirFor } from '../src/writer.js';
import { type Project, connect, makeProject, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;
let project: Project;

beforeAll(async () => {
  site = await startSite({
    '/start': html('Start', '<a href="/done">Finish line</a> <a href="/start?x">Stay</a>'),
    '/done': html('Done', '<h1>Order confirmed</h1>'),
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

async function run(output: string, link: string, runId = 'test-run') {
  project = makeProject(
    site.url,
    [site.host],
    'id: checkout\ngoal: Reach the end.\nstart_url: /start\nsuccess:\n  any:\n    - url_contains: /done\n',
  );
  const config = readFileSync(join(project.dir, '.personaqa/config.yaml'), 'utf8');
  project.write('.personaqa/config.yaml', `${config}output:\n${output}`);
  harness = await connect(project);

  const { text } = await harness.call('start_session', {
    persona: 'james',
    mission: 'checkout',
    run_id: runId,
  });
  const id = sessionIdFrom(text);
  const screen = (await harness.call('look', { session: id })).text;
  const ref = new RegExp(`\\[(e\\d+) link "${link}"`).exec(screen)?.[1] ?? 'missing';
  await harness.call('tap', { session: id, ref });
  const finished = await harness.call('finish', {
    session: id,
    journal: 'I tapped the link and it worked.',
  });

  return {
    dir: join(project.dir, '.personaqa/runs', runId, 'james--checkout'),
    finished: finished.text,
  };
}

describe('run folder', () => {
  it('writes journal, issues, run facts and the action log', async () => {
    const { dir, finished } = await run('  trace: on_failure\n', 'Finish line');

    expect(readdirSync(dir).sort()).toEqual([
      'actions.log',
      'issues.json',
      'journal.md',
      'run.json',
      'screenshots',
    ]);
    expect(finished).toContain('Run files: .personaqa/runs/test-run/james--checkout/journal.md');

    const journal = readFileSync(join(dir, 'journal.md'), 'utf8');
    expect(journal).toContain('# James - checkout');
    expect(journal).toContain('| Outcome | **success** (mission success: URL contains "/done") |');
    expect(journal).toContain('I tapped the link and it worked.');

    expect(JSON.parse(readFileSync(join(dir, 'issues.json'), 'utf8'))).toMatchObject({
      persona: 'james',
      mission: 'checkout',
      issues: [],
    });

    const facts = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(facts).toMatchObject({
      outcome: 'success',
      steps: 1,
      environment: 'desktop, mouse, fast connection',
    });
    expect(facts['final_url']).toBe(`${site.url}/done`);

    const log = readFileSync(join(dir, 'actions.log'), 'utf8');
    expect(log).toMatch(/step {3}0 {2}start james x checkout at http/);
    expect(log).toMatch(/step {3}0 {2}look/);
    expect(log).toMatch(/step {3}1 {2}tap e\d+ \(\d\.\ds\) .*\/done :: You tapped e\d+\./);
    expect(log).toMatch(/end success: mission success/);
    expect(log).toMatch(/finish success/);
  });

  it('keeps the trace for failed runs only when trace is on_failure', async () => {
    const failed = await run('  trace: on_failure\n', 'Stay', 'failed-run');

    expect(existsSync(join(failed.dir, 'trace.zip'))).toBe(true);
    expect(failed.finished).toContain('trace.zip');
  });

  it('always keeps the trace when trace is always', async () => {
    const { dir } = await run('  trace: always\n', 'Finish line', 'always-run');

    expect(existsSync(join(dir, 'trace.zip'))).toBe(true);
  });

  it('screenshots every action, or only the final screen', async () => {
    const every = await run('  screenshots: every_action\n  trace: off\n', 'Stay', 'every');
    const shots = readdirSync(join(every.dir, 'screenshots'));
    expect(shots).toEqual(['001-step-1-tap.jpg', '002-final.jpg']);
    await harness.close();

    const issueOnly = await run('  screenshots: on_issue\n  trace: off\n', 'Stay', 'on-issue');
    expect(readdirSync(join(issueOnly.dir, 'screenshots'))).toEqual(['001-final.jpg']);
    await harness.close();

    const off = await run('  screenshots: off\n  trace: off\n', 'Stay', 'off');
    expect(readdirSync(join(off.dir, 'screenshots'))).toEqual([]);
  });
});

describe('helpers', () => {
  it('makes file-safe run ids from timestamps', () => {
    expect(newRunId(new Date('2026-11-14T21:50:33Z'))).toBe('2026-11-14T21-50-33');
  });

  it('resolves run folders against the project unless absolute', () => {
    expect(runDirFor('/repo', '.personaqa/runs', 'r1', 'james--checkout')).toBe(
      '/repo/.personaqa/runs/r1/james--checkout',
    );
    expect(runDirFor('/repo', '/tmp/runs', 'r1', 'a--b')).toBe('/tmp/runs/r1/a--b');
  });
});
