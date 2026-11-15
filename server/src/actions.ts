import type { Locator } from 'playwright';
import { PersonaQAError } from './errors.js';
import type { Session } from './sessions.js';
import { addTypos } from './typos.js';

export const KEYS = [
  'Tab',
  'Shift+Tab',
  'Enter',
  'Escape',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const;

export type Key = (typeof KEYS)[number];

export interface ActionResult {
  /** What happened, in plain words for the persona. */
  summary: string;
  durationMs: number;
}

async function target(
  session: Session,
  ref: string,
): Promise<{ locator: Locator; x: number; y: number }> {
  if (!/^e\d+$/.test(ref)) {
    throw new PersonaQAError(`"${ref}" is not a ref. Use the id in brackets from look, e.g. e12.`);
  }

  const locator = session.page.locator(`[data-pqa-ref="${ref}"]`);
  if ((await locator.count()) === 0) {
    throw new PersonaQAError(`${ref} is not on the page any more. Look again.`);
  }

  const box = await locator.first().boundingBox();
  const viewport = session.page.viewportSize();
  if (box === null || viewport === null) {
    throw new PersonaQAError(`${ref} is not visible right now. Look again.`);
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) {
    throw new PersonaQAError(`${ref} is not on the screen. Scroll to it first.`);
  }

  return { locator: locator.first(), x, y };
}

/** What a press at (x, y) will actually land on, if it is not the intended element. */
async function interceptor(locator: Locator, x: number, y: number): Promise<string | null> {
  return locator.evaluate(
    (element, point) => {
      const top = document.elementFromPoint(point.x, point.y);
      if (top === null || element.contains(top) || top.contains(element)) return null;
      if (
        element instanceof HTMLInputElement &&
        Array.from(element.labels ?? []).some((label) => label.contains(top))
      ) {
        return null;
      }
      let block: Element = top;
      while (block.parentElement !== null && (block as HTMLElement).innerText.trim().length < 20) {
        block = block.parentElement;
      }
      return (
        (block as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 60) ||
        top.tagName.toLowerCase()
      );
    },
    { x, y },
  );
}

async function timed(session: Session, action: () => Promise<string>): Promise<ActionResult> {
  const started = Date.now();
  session.activity.mark();
  const summary = await action();
  session.activity.mark();
  await session.activity.settle();
  await session.page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
  return { summary, durationMs: Date.now() - started };
}

async function press(session: Session, x: number, y: number): Promise<void> {
  if (session.touch) {
    await session.page.touchscreen.tap(x, y);
    return;
  }
  await session.page.mouse.click(x, y);
}

export async function tap(session: Session, ref: string): Promise<ActionResult> {
  const { locator, x, y } = await target(session, ref);
  const blocker = await interceptor(locator, x, y);

  return timed(session, async () => {
    await press(session, x, y);
    return blocker === null
      ? `You tapped ${ref}.`
      : `You tapped where ${ref} is, but hit "${blocker}" instead.`;
  });
}

export async function type(
  session: Session,
  ref: string,
  text: string,
  submit: boolean,
): Promise<ActionResult> {
  const { locator, x, y } = await target(session, ref);
  const blocker = await interceptor(locator, x, y);
  if (blocker !== null) {
    throw new PersonaQAError(`You cannot reach ${ref}: "${blocker}" is in the way.`);
  }

  const typed = addTypos(text, session.persona.traits.typo_rate, session.random);

  return timed(session, async () => {
    const focused = await locator.evaluate((element) => element === document.activeElement);
    if (!focused) {
      await press(session, x, y);
    }
    await session.page.keyboard.press('ControlOrMeta+A');
    await session.page.keyboard.type(typed, { delay: 15 });
    if (submit) {
      await session.page.keyboard.press('Enter');
    }

    const slip = typed === text ? '' : ` A typo slipped in: you actually typed "${typed}".`;
    return `You typed "${text}" into ${ref}${submit ? ' and pressed Enter' : ''}.${slip}`;
  });
}

export async function pressKey(session: Session, key: Key): Promise<ActionResult> {
  return timed(session, async () => {
    await session.page.keyboard.press(key === 'Space' ? ' ' : key);
    return `You pressed ${key}.`;
  });
}

export async function scroll(
  session: Session,
  direction: 'up' | 'down',
  amount: 'screen' | 'half',
): Promise<ActionResult> {
  const viewport = session.page.viewportSize();
  const distance = Math.round((viewport?.height ?? 800) * (amount === 'screen' ? 0.85 : 0.45));

  return timed(session, async () => {
    const before = await session.page.evaluate(() => window.scrollY);
    await session.page.mouse.wheel(0, direction === 'down' ? distance : -distance);
    await session.page
      .waitForFunction((start) => window.scrollY !== start, before, { timeout: 500 })
      .catch(() => undefined);
    const after = await session.page.evaluate(() => window.scrollY);
    return after === before
      ? `You tried to scroll ${direction}, but the page did not move.`
      : `You scrolled ${direction}.`;
  });
}

export async function back(session: Session): Promise<ActionResult> {
  return timed(session, async () => {
    const response = await session.page
      .goBack({ waitUntil: 'commit', timeout: 30_000 })
      .catch(() => null);
    return response === null && session.page.url() === 'about:blank'
      ? 'There was nothing to go back to.'
      : 'You pressed the back button.';
  });
}
