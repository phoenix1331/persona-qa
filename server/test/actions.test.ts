import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addTypos, seededRandom } from '../src/typos.js';
import { connect, makeProject, persona, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

const mission = (path: string): string => `
id: checkout
goal: Get through.
start_url: ${path}
success:
  any:
    - url_contains: /never
`;

const pages = {
  '/form': html(
    'Form',
    `<h1>Form</h1>
     <a href="/slow">Slow page</a>
     <form action="/thanks"><label for="n">Name</label><input id="n" name="n"><button>Send</button></form>
     <div style="height:3000px"></div><a href="/far">Far link</a>`,
  ),
  '/covered': html(
    'Covered',
    `<button onclick="document.title='paid'">Pay now</button>
     <div style="position:fixed;inset:0;background:#000;color:#fff" onclick="document.title='banner'">We value your privacy</div>`,
  ),
  '/slow': { ...html('Slow', '<h1>Finally</h1>'), delayMs: 1200 },
  '/thanks': html('Thanks', '<h1>Thanks</h1>'),
};

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  site = await startSite(pages);
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

async function open(path: string, typoRate?: string) {
  const project = makeProject(site.url, [site.host], mission(path));
  if (typoRate !== undefined) {
    project.write(
      'builtin:james.yaml',
      persona().replace('tech_confidence: high', `tech_confidence: high\n  typo_rate: ${typoRate}`),
    );
  }
  harness = await connect(project);
  const { text } = await harness.call('start_session', { persona: 'james', mission: 'checkout' });
  const id = sessionIdFrom(text);
  const first = (await harness.call('look', { session: id })).text;
  const ref = (label: string, screen = first): string => {
    const match = new RegExp(`\\[(e\\d+) [a-z]+ "${label}"`).exec(screen);
    if (match?.[1] === undefined) throw new Error(`No ${label} in\n${screen}`);
    return match[1];
  };
  return { id, first, ref, session: () => harness.sessions.get(id) };
}

describe('tap', () => {
  it('follows a link, counts the step and returns the new screen with timing', async () => {
    const { id, ref, session } = await open('/form');

    const result = await harness.call('tap', { session: id, ref: ref('Slow page') });

    expect(result.text).toMatch(/^You tapped e\d+\. The page took 1\.\d+s to respond\./);
    expect(result.text).toContain('# Finally');
    expect(session().steps).toBe(1);
    expect(session().lastActionMs).toBeGreaterThanOrEqual(1200);
  });

  it('hits whatever covers the control, like a real finger', async () => {
    const { id, ref, session } = await open('/covered');

    const result = await harness.call('tap', { session: id, ref: ref('Pay now') });

    expect(result.text).toContain('but hit "We value your privacy" instead');
    expect(await session().page.title()).toBe('banner');
  });
});

describe('ref errors', () => {
  it('explains each problem', async () => {
    const { id, session } = await open('/form');
    await session().page.evaluate(() => {
      const link = document.querySelectorAll('a')[1];
      link?.setAttribute('data-pqa-ref', 'e999');
    });

    const offScreen = await harness.call('tap', { session: id, ref: 'e999' });
    const unknown = await harness.call('tap', { session: id, ref: 'e5000' });
    const malformed = await harness.call('tap', { session: id, ref: 'Pay' });

    expect(offScreen.text).toContain('is not on the screen. Scroll to it first.');
    expect(unknown.text).toContain('is not on the page any more');
    expect(malformed.text).toContain('is not a ref');
    expect(session().steps).toBe(0);
  });
});

describe('type', () => {
  it('fills a field and submits with Enter', async () => {
    const { id, ref } = await open('/form');

    const result = await harness.call('type', {
      session: id,
      ref: ref('Name'),
      text: 'James',
      submit: true,
    });

    expect(result.text).toContain('You typed "James" into');
    expect(result.text).toContain('and pressed Enter');
    expect(result.text).toContain('URL: /thanks?n=James');
  });

  it('replaces existing text', async () => {
    const { id, ref, session } = await open('/form');
    await harness.call('type', { session: id, ref: ref('Name'), text: 'Jim' });
    await harness.call('type', { session: id, ref: ref('Name'), text: 'James' });

    expect(await session().page.inputValue('#n')).toBe('James');
  });

  it('applies the persona typo rate and says what was really typed', async () => {
    const { id, ref, session } = await open('/form', 'high');

    const result = await harness.call('type', {
      session: id,
      ref: ref('Name'),
      text: 'the quick brown fox jumps over the lazy dog again and again',
    });
    const value = await session().page.inputValue('#n');

    expect(value).not.toBe('the quick brown fox jumps over the lazy dog again and again');
    expect(result.text).toContain(`A typo slipped in: you actually typed "${value}"`);
  });

  it('refuses a covered field', async () => {
    const { id, session } = await open('/covered');
    await session().page.evaluate(() => {
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Hidden field');
      document.body.prepend(input);
    });
    const screen = (await harness.call('look', { session: id })).text;
    const field = /\[(e\d+) textbox "Hidden field"/.exec(screen)?.[1] ?? 'missing';

    const result = await harness.call('type', { session: id, ref: field, text: 'x' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('"We value your privacy" is in the way');
  });
});

describe('press, scroll and back', () => {
  it('moves focus with Tab', async () => {
    const { id } = await open('/form');

    const result = await harness.call('press', { session: id, key: 'Tab' });

    expect(result.text).toMatch(/You pressed Tab\./);
    expect(result.text).toMatch(/\[e\d+ link "Slow page" focused\]/);
  });

  it('rejects keys outside the human set', async () => {
    const { id } = await open('/form');

    const result = await harness.call('press', { session: id, key: 'F12' });

    expect(result.isError).toBe(true);
  });

  it('scrolls down to reveal content and reports when it cannot move', async () => {
    const { id } = await open('/form');

    const down = await harness.call('scroll', { session: id, direction: 'down' });
    const up = await harness.call('scroll', { session: id, direction: 'up', amount: 'half' });
    await harness.call('scroll', { session: id, direction: 'up' });
    const again = await harness.call('scroll', { session: id, direction: 'up' });

    expect(down.text).toContain('You scrolled down.');
    expect(up.text).toContain('You scrolled up.');
    expect(again.text).toContain('the page did not move');
  });

  it('goes back to the previous page', async () => {
    const { id, ref } = await open('/form');
    await harness.call('tap', { session: id, ref: ref('Slow page') });

    const result = await harness.call('back', { session: id });

    expect(result.text).toContain('You pressed the back button.');
    expect(result.text).toContain('URL: /form');
  });
});

describe('typos', () => {
  it('is deterministic per seed and leaves digits alone', () => {
    const first = addTypos('hello world 4242 4242', 'high', seededRandom('james--checkout--abcd'));
    const second = addTypos('hello world 4242 4242', 'high', seededRandom('james--checkout--abcd'));

    expect(first).toBe(second);
    expect(first.endsWith('4242 4242')).toBe(true);
  });

  it('never changes text at rate none', () => {
    expect(addTypos('exactly this', 'none', () => 0)).toBe('exactly this');
    expect(addTypos('exactly this', undefined, () => 0)).toBe('exactly this');
  });

  it('keeps capitals capital', () => {
    expect(addTypos('A', 'high', () => 0)).toBe('Q');
  });
});
