import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { diffLines } from '../src/snapshot.js';
import { connect, makeProject, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

const mission = (path: string): string => `
id: checkout
goal: Look around.
start_url: ${path}
success:
  any:
    - url_contains: /never
`;

const shop = html(
  'Checkout - Shop',
  `
  <h1>Checkout</h1>
  <p>Already have an account? <a href="/login">Sign in</a> to save time.</p>
  <img src="/crest.svg" alt="IMG_2041.png">
  <img src="/decor.svg" alt="">
  <img src="/mystery.svg">
  <form>
    <fieldset><legend>Ticket type</legend>
      <label><input type="radio" name="t" checked> Adult</label>
      <label><input type="radio" name="t"> Child</label>
    </fieldset>
    <label for="name">Full name</label><input id="name" value="James">
    <input id="cvc" placeholder="CVC">
    <input type="password" id="pw" value="secret">
    <select id="when"><option>Saturday</option><option selected>Sunday</option></select>
    <a href="/seat/1" aria-label="North Stand, row A, seat 1">1</a>
    <button type="button" disabled>Disabled</button>
    <div style="cursor:pointer" onclick="void 0"><span>Done</span></div>
    <p style="display:none">Hidden text</p>
    <p aria-hidden="true">Aria hidden</p>
    <div role="alert">Card declined</div>
  </form>
  <div style="height:2000px"></div>
  <p>Footer text far below</p>
  <a href="/terms">Terms</a>
`,
);

const banner = html(
  'Banner',
  `
  <style>.bar{position:fixed;bottom:0;left:0;right:0;height:200px;background:#000;color:#fff}</style>
  <p>Top</p>
  <div style="height:560px"></div>
  <button id="pay">Pay now</button>
  <div class="bar">We value your privacy. We and our partners use cookies.</div>
`,
);

const seatRows = Array.from({ length: 20 }, (_, row) => {
  const seats = Array.from(
    { length: 12 },
    (_, seat) =>
      `<a style="display:inline-block;width:40px;height:40px" href="/c?s=${row}-${seat}" aria-label="Row ${row}, seat ${seat + 1}, £22.50">${seat + 1}</a>`,
  ).join('');
  return `<div><span>Row ${row}</span> ${seats}</div>`;
}).join('');

const seatMap = html('Seats', `<h1>Pick a seat</h1>${seatRows}`);

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  site = await startSite({
    '/shop': shop,
    '/banner': banner,
    '/seats': seatMap,
    '/crest.svg': {
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      type: 'image/svg+xml',
    },
    '/decor.svg': {
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      type: 'image/svg+xml',
    },
    '/mystery.svg': {
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      type: 'image/svg+xml',
    },
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

async function open(
  path: string,
): Promise<{ id: string; look: (screenshot?: boolean) => Promise<string> }> {
  harness = await connect(makeProject(site.url, [site.host], mission(path)));
  const { text } = await harness.call('start_session', { persona: 'james', mission: 'checkout' });
  const id = sessionIdFrom(text);
  return {
    id,
    look: async (screenshot = false) =>
      (await harness.call('look', { session: id, screenshot })).text,
  };
}

describe('look', () => {
  it('describes the visible screen compactly with inline controls', async () => {
    const { look } = await open('/shop');
    const text = await look();

    expect(text).toContain('Page: Checkout - Shop\nURL: /shop');
    expect(text).toContain('# Checkout');
    expect(text).toMatch(/Already have an account\? \[e\d+ link "Sign in"\] to save time\./);
    expect(text).toContain('[image "IMG_2041.png"]');
    expect(text).toContain('[image with no description]');
    expect(text).toContain('Group: Ticket type');
    expect(text).toMatch(/\[e\d+ radio "Adult" checked\]/);
    expect(text).toMatch(/\[e\d+ radio "Child" not checked\]/);
    expect(text).toMatch(/\[e\d+ textbox "Full name" value: "James"\]/);
    expect(text).toMatch(/\[e\d+ textbox \(no name\) placeholder: "CVC"\]/);
    expect(text).toMatch(/\[e\d+ textbox \(no name\) value: ••••\]/);
    expect(text).toMatch(/\[e\d+ combobox \(no name\) selected: "Sunday"\]/);
    expect(text).toMatch(/\[e\d+ link "1" \(read aloud as "North Stand, row A, seat 1"\)\]/);
    expect(text).toMatch(/\[e\d+ button "Disabled" disabled\]/);
    expect(text).toMatch(/\[e\d+ clickable "Done"\]/);
    expect(text).toContain('Alert: Card declined');
    expect(text).not.toContain('Hidden text');
    expect(text).not.toContain('Aria hidden');
    expect(text).not.toContain('secret');
  });

  it('summarises content below the screen instead of listing it', async () => {
    const { look } = await open('/shop');
    const text = await look();

    expect(text).not.toContain('Footer text far below');
    expect(text).toMatch(
      /Below the screen: 2 lines of content with 1 control, about \d screens? more\./,
    );
  });

  it('flags controls covered by an overlay', async () => {
    const { look } = await open('/banner');

    expect(await look()).toMatch(
      /\[e\d+ button "Pay now" covered by "We value your privacy\. We and our partners use co…"\]/,
    );
  });

  it('keeps refs stable and reports only changes on the same page', async () => {
    const { id, look } = await open('/shop');
    const first = await look();
    const ref = /\[(e\d+) link "Sign in"\]/.exec(first)?.[1];

    expect(await look()).toContain('Nothing on screen has changed since you last looked.');

    await harness.sessions.get(id).page.evaluate(() => {
      const alert = document.querySelector('[role=alert]');
      if (alert !== null) alert.textContent = 'Payment accepted';
    });
    const changed = await look();

    expect(changed).toContain('Changes since you last looked');
    expect(changed).toContain('- Alert: Card declined');
    expect(changed).toContain('+ Alert: Payment accepted');
    expect(changed).not.toContain('# Checkout');

    expect(changed).not.toContain('Sign in');

    await harness.sessions.get(id).page.goto(`${site.url}/shop?again=1`);
    const after = await look();
    const newRef = /\[(e\d+) link "Sign in"\]/.exec(after)?.[1];

    expect(after).toContain('# Checkout');
    expect(newRef).toBeDefined();
    expect(newRef).not.toBe(ref);
  });

  it('keeps a 240-seat map small on a phone screen', async () => {
    const { id, look } = await open('/seats');
    await harness.sessions.get(id).page.setViewportSize({ width: 390, height: 844 });
    const text = await look();

    expect(text).toContain('# Pick a seat');
    expect(text).toMatch(/Row 0 \[e\d+ link "1" \(read aloud as "Row 0, seat 1, £22\.50"\)\]/);
    expect(text).toMatch(/Below the screen: \d+ lines of content with \d+ controls/);
    expect(text.length).toBeLessThan(9000);
  });

  it('returns a screenshot when asked', async () => {
    const { id } = await open('/shop');
    const result = await harness.client.callTool({
      name: 'look',
      arguments: { session: id, screenshot: true },
    });
    const content = result.content as { type: string; mimeType?: string }[];

    expect(content.map((item) => item.type)).toEqual(['text', 'image']);
    expect(content[1]?.mimeType).toBe('image/jpeg');
  });

  it('shows notices before the snapshot, once', async () => {
    const { id, look } = await open('/shop');
    harness.sessions.get(id).notices.push('Signal lost');

    expect(await look()).toMatch(/^Notice: Signal lost\nPage:/);
    expect(await look()).not.toContain('Signal lost');
  });

  it('refuses ended sessions', async () => {
    const { id } = await open('/shop');
    await harness.call('finish', { session: id, journal: 'Done.' });

    const result = await harness.call('look', { session: id });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('has ended');
  });
});

describe('diffLines', () => {
  it('marks kept, added and removed lines', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual(['  a', '- b', '  c', '+ d']);
  });

  it('handles empty inputs', () => {
    expect(diffLines([], ['x'])).toEqual(['+ x']);
    expect(diffLines(['x'], [])).toEqual(['- x']);
  });
});
