import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PRESETS, resolveEnvironment } from '../src/environment.js';
import { connect, makeProject, persona, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

const mission = `
id: checkout
goal: Look around.
start_url: /env
success:
  any:
    - url_contains: /never
`;

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
  site = await startSite({
    '/env': html(
      'Env',
      `<p id="rem" style="font-size:1rem">Relative</p><p id="px" style="font-size:16px">Fixed</p>
       <a href="/next">Next</a><label for="q">Search</label><input id="q">`,
    ),
    '/next': html('Next', '<h1>Next</h1>'),
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness?.close();
});

async function open(environment: string) {
  const project = makeProject(site.url, [site.host], mission);
  project.write(
    'builtin:james.yaml',
    persona().replace('environment:\n  preset: desktop-fast\n', `environment:\n${environment}`),
  );
  harness = await connect(project);
  const started = await harness.call('start_session', { persona: 'james', mission: 'checkout' });
  const id = sessionIdFrom(started.text);
  return { id, brief: started.text, page: () => harness.sessions.get(id).page };
}

describe('resolveEnvironment', () => {
  it('builds a phone on slow 3G from the preset', () => {
    const resolved = resolveEnvironment({ preset: 'mobile-3g' });

    expect(resolved.contextOptions).toMatchObject({
      isMobile: true,
      hasTouch: true,
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
    expect(resolved.contextOptions.viewport).toEqual({ width: 393, height: 659 });
    expect(resolved.network).toBe('slow-3g');
    expect(resolved.description).toBe('iPhone 15, touch screen, slow 3g connection');
  });

  it('lets the persona override device, network and locale', () => {
    const resolved = resolveEnvironment({
      preset: 'mobile-3g',
      device: 'Pixel 7',
      network: '4g',
      locale: 'pl-PL',
      timezone: 'Europe/Warsaw',
    });

    expect(resolved.contextOptions.userAgent).toContain('Pixel 7');
    expect(resolved.contextOptions).toMatchObject({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
    expect(resolved.network).toBe('4g');
  });

  it('describes accessibility settings', () => {
    expect(resolveEnvironment({ preset: 'desktop-reduced-motion' }).description).toBe(
      'desktop, mouse, fast connection, reduced motion, high contrast mode',
    );
    expect(resolveEnvironment({ preset: 'ipad-large-text' }).description).toContain(
      'text enlarged to 150%',
    );
    expect(resolveEnvironment({ preset: 'desktop-keyboard-only' }).input).toBe('keyboard_only');
  });

  it('rejects unknown devices', () => {
    expect(() => resolveEnvironment({ preset: 'mobile-4g', device: 'Nokia 3310' })).toThrow(
      /Unknown device "Nokia 3310"/,
    );
  });

  it('defines every preset in the schema', () => {
    expect(Object.keys(PRESETS).sort()).toEqual([
      'desktop-fast',
      'desktop-keyboard-only',
      'desktop-reduced-motion',
      'ipad-large-text',
      'mobile-3g',
      'mobile-4g',
    ]);
  });
});

describe('enforced environment', () => {
  it('applies device, touch, locale and timezone to the browser', async () => {
    const { page, brief } = await open(
      '  preset: mobile-4g\n  locale: pl-PL\n  timezone: Europe/Warsaw\n',
    );

    const facts = await page().evaluate(() => ({
      width: screen.width,
      touch: navigator.maxTouchPoints > 0,
      mobileUa: /iPhone/.test(navigator.userAgent),
      language: navigator.language,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));

    expect(facts).toEqual({
      width: 393,
      touch: true,
      mobileUa: true,
      language: 'pl-PL',
      zone: 'Europe/Warsaw',
    });
    expect(brief).toContain('### Your device\niPhone 15, touch screen, 4g connection.');
  });

  it('throttles the network on slow 3G', async () => {
    const { id } = await open('  preset: mobile-3g\n');
    const screen = (await harness.call('look', { session: id })).text;
    const next = /\[(e\d+) link "Next"\]/.exec(screen)?.[1] ?? 'missing';

    const result = await harness.call('tap', { session: id, ref: next });

    expect(result.text).toMatch(/The page took ([2-9]|\d\d)\.\ds to respond/);
  });

  it('emulates reduced motion and forced colours', async () => {
    const { page } = await open('  preset: desktop-reduced-motion\n');

    const media = await page().evaluate(() => ({
      motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      forced: matchMedia('(forced-colors: active)').matches,
    }));

    expect(media).toEqual({ motion: true, forced: true });
  });

  it('enlarges relative text but not fixed pixel text', async () => {
    const { page } = await open('  preset: ipad-large-text\n');

    const sizes = await page().evaluate(() => ({
      rem: getComputedStyle(document.getElementById('rem') as Element).fontSize,
      px: getComputedStyle(document.getElementById('px') as Element).fontSize,
    }));

    expect(sizes).toEqual({ rem: '24px', px: '16px' });
  });

  it('refuses taps for keyboard-only personas and requires focus to type', async () => {
    const { id, brief } = await open('  preset: desktop-keyboard-only\n');
    const screen = (await harness.call('look', { session: id })).text;
    const link = /\[(e\d+) link "Next"\]/.exec(screen)?.[1] ?? 'missing';
    const field = /\[(e\d+) textbox "Search"\]/.exec(screen)?.[1] ?? 'missing';

    const tapped = await harness.call('tap', { session: id, ref: link });
    const typedUnfocused = await harness.call('type', { session: id, ref: field, text: 'tickets' });
    await harness.call('press', { session: id, key: 'Tab' });
    await harness.call('press', { session: id, key: 'Tab' });
    const typed = await harness.call('type', { session: id, ref: field, text: 'tickets' });

    expect(brief).toContain('tap is not available to you');
    expect(tapped.text).toContain('You only use the keyboard');
    expect(typedUnfocused.text).toContain('Tab to it first');
    expect(typed.text).toContain('You typed "tickets"');
  });
});
