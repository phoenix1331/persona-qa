import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { planEvents } from '../src/events.js';
import { type Project, connect, makeProject, persona, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;
let project: Project;

beforeAll(async () => {
  site = await startSite({
    '/start': html(
      'Start',
      `<a href="/next">Next</a> <a href="/start?again">Again</a>
       <p id="who"></p>
       <script>
         if (!document.cookie.includes('sid=')) document.cookie = 'sid=abc; path=/';
         document.getElementById('who').textContent = 'cookie: ' + document.cookie;
       </script>`,
    ),
    '/next': html('Next', '<h1>Next page</h1>'),
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

async function open(events = '') {
  project = makeProject(
    site.url,
    [site.host],
    'id: checkout\ngoal: Go.\nstart_url: /start\nsuccess:\n  any:\n    - url_contains: /never\n',
  );
  project.write(
    'builtin:james.yaml',
    persona().replace(
      'environment:\n  preset: desktop-fast\n',
      `environment:\n  preset: desktop-fast\n${events}`,
    ),
  );
  harness = await connect(project);
  const { text } = await harness.call('start_session', {
    persona: 'james',
    mission: 'checkout',
    run_id: 'events',
  });
  const id = sessionIdFrom(text);
  const screen = (await harness.call('look', { session: id })).text;
  const ref = (label: string) =>
    new RegExp(`\\[(e\\d+) link "${label}"`).exec(screen)?.[1] ?? 'missing';
  return { id, ref, session: () => harness.sessions.get(id) };
}

describe('record_issue', () => {
  it('stores the issue with step, url and screenshot, and writes it on finish', async () => {
    const { id } = await open();

    const result = await harness.call('record_issue', {
      session: id,
      title: 'Next link is tiny',
      severity: 'medium',
      what_happened: 'I nearly missed the link.',
      expected: 'A clear button.',
    });
    await harness.call('finish', { session: id, journal: 'Meh.' });

    expect(result.text).toMatch(
      /^Recorded james-checkout-1 \(medium\): Next link is tiny with screenshots\/001-issue-1\.jpg\.$/,
    );
    const written = JSON.parse(
      readFileSync(join(project.dir, '.personaqa/runs/events/james--checkout/issues.json'), 'utf8'),
    ) as { issues: Record<string, unknown>[] };
    expect(written.issues[0]).toMatchObject({
      id: 'james-checkout-1',
      step: 0,
      severity: 'medium',
      url: `${site.url}/start`,
      screenshot: 'screenshots/001-issue-1.jpg',
    });
  });

  it('rejects unknown severities and issues after finish', async () => {
    const { id } = await open();
    const bad = await harness.call('record_issue', {
      session: id,
      title: 'Odd',
      severity: 'urgent',
      what_happened: 'x x',
      expected: 'y y',
    });
    await harness.call('finish', { session: id, journal: 'Done.' });
    const late = await harness.call('record_issue', {
      session: id,
      title: 'Late one',
      severity: 'low',
      what_happened: 'x x',
      expected: 'y y',
    });

    expect(bad.isError).toBe(true);
    expect(late.text).toContain('issues can no longer be added');
  });
});

describe('give_up', () => {
  it('ends the session as abandoned with the reason', async () => {
    const { id, session } = await open();

    const result = await harness.call('give_up', { session: id, reason: 'Too slow on my bus' });
    const after = await harness.call('look', { session: id });
    const finished = await harness.call('finish', { session: id, journal: 'Gave up.' });

    expect(result.text).toBe('You gave up. Call finish with your journal.');
    expect(after.text).toContain('has ended');
    expect(session().outcome).toBe('abandoned');
    expect(finished.text).toContain('Outcome: abandoned (gave up: Too slow on my bus)');
  });
});

describe('events', () => {
  it('drops the signal before the planned step and restores it after the duration', async () => {
    const { id, ref, session } = await open(
      '  events:\n    offline:\n      chance: 1\n      duration_seconds: [1, 1]\n',
    );
    const planned = session().plannedEvents[0];
    expect(planned).toMatchObject({ type: 'offline', durationSeconds: 1 });

    for (let step = 1; step < (planned?.atStep ?? 2); step += 1) {
      await harness.call('scroll', { session: id, direction: 'down' });
    }
    const offline = await harness.call('tap', { session: id, ref: ref('Next') });

    expect(offline.text).toContain('Notice: Your signal just dropped.');
    expect(offline.text).not.toContain('# Next page');

    await new Promise((resolve) => setTimeout(resolve, 1300));
    const back = await harness.call('look', { session: id });
    expect(back.text).toContain('Notice: Your signal is back.');
    expect(session().firedEvents.map((event) => event.detail)).toEqual([
      'offline for 1s',
      'connection restored',
    ]);
  });

  it('expires the session by clearing cookies, without telling the persona', async () => {
    const { id, ref, session } = await open(
      '  events:\n    session_expiry:\n      chance: 1\n      after_steps: [2, 2]\n',
    );

    await harness.call('tap', { session: id, ref: ref('Again') });
    const before = await session().context.cookies();
    const second = await harness.call('scroll', { session: id, direction: 'down' });
    const after = await session().context.cookies();

    expect(before.map((cookie) => cookie.name)).toContain('sid');
    expect(after).toEqual([]);
    expect(second.text).not.toContain('Notice');
    expect(session().firedEvents[0]).toMatchObject({ type: 'session_expiry', step: 2 });
  });

  it('plans nothing when chances are zero and is deterministic per session', async () => {
    const { session } = await open(
      '  events:\n    offline:\n      chance: 0\n      duration_seconds: [5, 5]\n',
    );

    expect(session().plannedEvents).toEqual([]);
    expect(
      planEvents({
        ...session(),
        random: () => 0.1,
        persona: { ...session().persona, environment: { preset: 'desktop-fast' } },
      }),
    ).toEqual([]);
  });
});
