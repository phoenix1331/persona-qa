import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkSuccess, describeRule } from '../src/mission.js';
import { connect, makeProject, persona, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  site = await startSite({
    '/start': html(
      'Start',
      '<a href="/order/confirmed?ref=1">Buy</a> <a href="/slow">Slow</a> <a href="/start?again">Again</a>',
    ),
    '/order/confirmed': html('Done', '<h1 id="done">Order confirmed</h1>'),
    '/slow': { ...html('Slow', '<p>Slow</p>'), delayMs: 1300 },
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

async function open(
  missionExtra: string,
  success = 'any:\n    - url_contains: /order/confirmed',
  patience = 8,
) {
  const project = makeProject(
    site.url,
    [site.host],
    `id: checkout\ngoal: Buy.\nstart_url: /start\n${missionExtra}\nsuccess:\n  ${success}\n`,
  );
  project.write(
    'builtin:james.yaml',
    persona().replace('patience_seconds: 8', `patience_seconds: ${patience}`),
  );
  harness = await connect(project);
  const { text } = await harness.call('start_session', { persona: 'james', mission: 'checkout' });
  const id = sessionIdFrom(text);
  const screen = (await harness.call('look', { session: id })).text;
  const ref = (label: string) =>
    new RegExp(`\\[(e\\d+) link "${label}"`).exec(screen)?.[1] ?? 'missing';
  return { id, ref, session: () => harness.sessions.get(id) };
}

describe('success', () => {
  it('ends the session as a success when the rule is met, decided by the server', async () => {
    const { id, ref, session } = await open('');

    const result = await harness.call('tap', { session: id, ref: ref('Buy') });

    expect(result.text).toContain('Mission complete (URL contains "/order/confirmed")');
    expect(session()).toMatchObject({ status: 'ended', outcome: 'success' });

    const after = await harness.call('look', { session: id });
    expect(after.text).toContain('has ended');

    const finished = await harness.call('finish', { session: id, journal: 'Bought it.' });
    expect(finished.text).toContain(
      'Outcome: success (mission success: URL contains "/order/confirmed")',
    );
  });

  it('requires every rule for "all"', async () => {
    const { id, ref, session } = await open(
      '',
      'all:\n    - url_contains: /order\n    - text_visible: Refund issued',
    );

    await harness.call('tap', { session: id, ref: ref('Buy') });

    expect(session().status).toBe('active');
  });

  it('cannot be claimed by the persona', async () => {
    const { id } = await open('');

    const finished = await harness.call('finish', {
      session: id,
      journal: 'I definitely bought a ticket.',
    });

    expect(finished.text).toContain('Outcome: incomplete');
  });
});

describe('limits', () => {
  it('ends the session at the step limit', async () => {
    const { id, ref, session } = await open('max_steps: 2');

    await harness.call('tap', { session: id, ref: ref('Again') });
    const second = await harness.call('scroll', { session: id, direction: 'down' });
    const third = await harness.call('scroll', { session: id, direction: 'down' });

    expect(second.text).toContain('The session has ended: step limit of 2 reached.');
    expect(third.isError).toBe(true);
    expect(session().outcome).toBe('limit');
  });

  it('ends the session at the time limit', async () => {
    const { id, session } = await open('time_limit_minutes: 0.001');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await harness.call('look', { session: id });

    expect(result.text).toContain('time limit of 0 minutes reached');
    expect(session().outcome).toBe('limit');
  });
});

describe('patience', () => {
  it('tells the persona when a wait beat their patience, and counts it', async () => {
    const { id, ref, session } = await open('', undefined, 1);

    const result = await harness.call('tap', { session: id, ref: ref('Slow') });

    expect(result.text).toMatch(
      /Notice: You waited 1\.\ds, longer than you would normally put up with \(1s\)\. That is 1 time so far\./,
    );
    expect(session().patienceBreaches).toBe(1);
    expect(session().longestWaitMs).toBeGreaterThanOrEqual(1300);
  });
});

describe('finish', () => {
  it('can only be called once', async () => {
    const { id } = await open('');
    await harness.call('finish', { session: id, journal: 'Once.' });

    const again = await harness.call('finish', { session: id, journal: 'Twice.' });

    expect(again.isError).toBe(true);
    expect(again.text).toContain('already finished');
  });
});

describe('rules', () => {
  it('describes each rule type', () => {
    expect(describeRule({ url_contains: '/x' })).toBe('URL contains "/x"');
    expect(describeRule({ url_matches: '^/x' })).toBe('URL matches /^/x/');
    expect(describeRule({ text_visible: 'Done' })).toBe('"Done" is visible');
    expect(describeRule({ element_visible: '#ok' })).toBe('#ok is visible');
  });

  it('checks text, elements and patterns on a live page', async () => {
    const { session, id, ref } = await open('', 'any:\n    - url_contains: /never');
    await harness.call('tap', { session: id, ref: ref('Buy') });
    const page = session().page;

    expect(await checkSuccess(page, { any: [{ text_visible: 'Order confirmed' }] })).toBe(
      '"Order confirmed" is visible',
    );
    expect(await checkSuccess(page, { any: [{ element_visible: '#done' }] })).toBe(
      '#done is visible',
    );
    expect(
      await checkSuccess(page, { all: [{ url_matches: 'ref=\\d' }, { element_visible: '#done' }] }),
    ).toBe('URL matches /ref=\\d/ and #done is visible');
    expect(await checkSuccess(page, { any: [{ element_visible: '#missing' }] })).toBeNull();
  });
});
