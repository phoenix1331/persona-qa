import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestSite, html, startSite } from './support/site.js';
import { connect, makeProject, persona, sessionIdFrom } from './support/harness.js';

const mission = `
id: checkout
goal: Buy one adult ticket.
start_url: /start
context: You know which match you want.
success:
  any:
    - url_contains: /done
data:
  card: "4242 4242 4242 4242"
`;

let site: TestSite;
let other: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  other = await startSite({ '/': html('Elsewhere', '<p>Off site</p>') });
  site = await startSite({
    '/start': html(
      'Start',
      `<h1>Fixtures</h1><a href="/next">Next</a><a id="away" href="${'URL'}/">Leave</a><img src="${'URL'}/tracker.gif">`,
    ),
  });
  const start = site.pages.get('/start');
  if (start !== undefined) {
    start.body = start.body.replaceAll('URL', other.url);
  }
});

afterAll(async () => {
  await site.close();
  await other.close();
});

afterEach(async () => {
  await harness.close();
});

describe('start_session', () => {
  it('opens the start page and returns the persona and mission brief', async () => {
    harness = await connect(makeProject(site.url, [site.host], mission));

    const result = await harness.call('start_session', { persona: 'james', mission: 'checkout' });

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^Session: james--checkout--[0-9a-f]{4}$/m);
    expect(result.text).toContain('## You are James, 23');
    expect(result.text).toContain('- patience seconds: 8');
    expect(result.text).toContain('Buy one adult ticket.');
    expect(result.text).toContain('You know which match you want.');
    expect(result.text).toContain('- card: 4242 4242 4242 4242');
    expect(site.hits).toContain('/start');

    const session = harness.sessions.get(sessionIdFrom(result.text));
    expect(await session.page.title()).toBe('Start');
  });

  it('blocks requests outside allowed_domains', async () => {
    harness = await connect(makeProject(site.url, [site.host], mission));
    const before = other.hits.length;

    const { text } = await harness.call('start_session', { persona: 'james', mission: 'checkout' });
    const session = harness.sessions.get(sessionIdFrom(text));
    await session.page.click('#away').catch(() => undefined);
    await session.page.waitForTimeout(200);

    expect(other.hits.length).toBe(before);
    expect(session.blockedRequests.some((url) => url.startsWith(other.url))).toBe(true);
    expect(session.notices.join(' ')).toContain(`refused to open ${other.host}`);
    expect(session.page.url()).toContain(site.url);
  });

  it('allows a base_url override and adds its host to the allowed list', async () => {
    harness = await connect(
      makeProject('https://staging.example.test', ['staging.example.test'], mission),
    );

    const { text, isError } = await harness.call('start_session', {
      persona: 'james',
      mission: 'checkout',
      base_url: site.url,
    });

    expect(isError).toBe(false);
    const session = harness.sessions.get(sessionIdFrom(text));
    expect(session.config.app.allowed_domains).toEqual(['staging.example.test', site.host]);
  });

  it('refuses a start URL outside allowed_domains', async () => {
    harness = await connect(makeProject(site.url, ['staging.example.test'], mission));

    const result = await harness.call('start_session', { persona: 'james', mission: 'checkout' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside app.allowed_domains');
  });

  it('reports unknown personas and invalid files as tool errors', async () => {
    const project = makeProject(site.url, [site.host], mission);
    project.write('.personaqa/personas/broken.yaml', persona('broken', 'colour: red'));
    harness = await connect(project);

    const unknown = await harness.call('start_session', { persona: 'nobody', mission: 'checkout' });
    const broken = await harness.call('start_session', { persona: 'broken', mission: 'checkout' });

    expect(unknown).toMatchObject({ isError: true });
    expect(unknown.text).toContain('Persona "nobody" not found');
    expect(broken.text).toContain('/: unknown field "colour"');
  });

  it('notes a start page that fails to load', async () => {
    const project = makeProject('http://127.0.0.1:1', ['127.0.0.1:1'], mission);
    harness = await connect(project);

    const { text } = await harness.call('start_session', { persona: 'james', mission: 'checkout' });

    expect(harness.sessions.get(sessionIdFrom(text)).notices[0]).toContain(
      'The first page did not load',
    );
  });
});

describe('finish', () => {
  it('records the journal, ends the session and refuses further use', async () => {
    harness = await connect(makeProject(site.url, [site.host], mission));
    const { text } = await harness.call('start_session', { persona: 'james', mission: 'checkout' });
    const id = sessionIdFrom(text);

    const finished = await harness.call('finish', { session: id, journal: 'Got bored and left.' });

    expect(finished.text).toContain('Outcome: incomplete (finished by persona)');
    const session = harness.sessions.get(id);
    expect(session.journal).toBe('Got bored and left.');
    expect(session.status).toBe('ended');
    expect(() => harness.sessions.active(id)).toThrow(/has ended/);
  });

  it('errors for unknown sessions', async () => {
    harness = await connect(makeProject(site.url, [site.host], mission));

    const result = await harness.call('finish', { session: 'nope', journal: 'x' });

    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain('No session "nope"');
  });

  it('lists start_session and finish as tools', async () => {
    harness = await connect(makeProject(site.url, [site.host], mission));

    const { tools } = await harness.client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['start_session', 'finish']),
    );
  });
});
