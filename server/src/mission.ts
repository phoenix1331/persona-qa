import type { Page } from 'playwright';
import { saveLogin } from './auth.js';
import type { Session } from './sessions.js';
import type { Mission, SuccessRule } from './types.js';

const RULE_TIMEOUT_MS = 250;

async function ruleMet(page: Page, rule: SuccessRule): Promise<boolean> {
  const url = page.url();

  if ('url_contains' in rule) {
    return url.includes(rule.url_contains);
  }

  if ('url_matches' in rule) {
    return new RegExp(rule.url_matches).test(url);
  }

  if ('text_visible' in rule) {
    return page
      .getByText(rule.text_visible)
      .first()
      .isVisible({ timeout: RULE_TIMEOUT_MS })
      .catch(() => false);
  }

  return page
    .locator(rule.element_visible)
    .first()
    .isVisible({ timeout: RULE_TIMEOUT_MS })
    .catch(() => false);
}

export function describeRule(rule: SuccessRule): string {
  if ('url_contains' in rule) return `URL contains "${rule.url_contains}"`;
  if ('url_matches' in rule) return `URL matches /${rule.url_matches}/`;
  if ('text_visible' in rule) return `"${rule.text_visible}" is visible`;
  return `${rule.element_visible} is visible`;
}

/** Returns which rules were met when the mission succeeded, or null. Never asks the model. */
export async function checkSuccess(
  page: Page,
  success: Mission['success'],
): Promise<string | null> {
  const rules = 'any' in success ? success.any : success.all;
  const results = await Promise.all(rules.map((rule) => ruleMet(page, rule)));
  const met = rules.filter((_rule, index) => results[index]);

  if ('any' in success ? met.length > 0 : met.length === rules.length) {
    return met.map(describeRule).join(' and ');
  }

  return null;
}

export function maxSteps(session: Session): number {
  return session.mission.max_steps ?? session.config.runner.max_steps_per_run;
}

export function timeLimitMs(session: Session): number {
  const minutes = session.mission.time_limit_minutes ?? session.config.runner.max_minutes_per_run;
  return minutes * 60_000;
}

export function limitReached(session: Session, now = Date.now()): string | null {
  if (session.steps >= maxSteps(session)) {
    return `step limit of ${maxSteps(session)} reached`;
  }

  const elapsed = now - session.startedAt;
  if (elapsed >= timeLimitMs(session)) {
    return `time limit of ${Math.round(timeLimitMs(session) / 60_000)} minutes reached`;
  }

  return null;
}

/** States the wait as a fact against the persona's patience; the persona decides what to do about it. */
export function patienceNotice(session: Session, waitedMs: number): string | null {
  const patienceMs = session.persona.traits.patience_seconds * 1000;
  if (waitedMs <= patienceMs) {
    return null;
  }

  session.patienceBreaches += 1;
  return `You waited ${(waitedMs / 1000).toFixed(1)}s, longer than you would normally put up with (${session.persona.traits.patience_seconds}s). That is ${session.patienceBreaches} time${session.patienceBreaches === 1 ? '' : 's'} so far.`;
}

/** Checks success first, then limits; ends the session when either applies. Returns a message for the persona. */
export async function evaluate(
  session: Session,
  end: (outcome: 'success' | 'limit', reason: string) => Promise<void>,
): Promise<string | null> {
  let prefix = '';
  const login = session.auth.loginMission;
  if (session.auth.phase === 'login' && login !== undefined) {
    const signedIn = await checkSuccess(session.page, login.success);
    if (signedIn !== null) {
      session.auth.phase = 'mission';
      session.writer.log(session, `signed in: ${signedIn}`);
      await session.page
        .goto(new URL(session.mission.start_url, session.baseUrl).toString(), {
          waitUntil: 'domcontentloaded',
        })
        .catch(() => undefined);
      prefix = `You are signed in. The browser has moved on to the start of your mission: ${session.mission.goal.trim()}`;
    }
  }

  const met =
    session.auth.phase === 'mission'
      ? await checkSuccess(session.page, session.mission.success)
      : null;
  if (met !== null) {
    const saved = await saveLogin(session);
    if (saved !== null) session.writer.log(session, `saved login to ${saved}`);
    await end('success', `mission success: ${met}`);
    const done = `Mission complete (${met}).${saved === null ? '' : ' The login has been saved.'} The session has ended: call finish with your journal.`;
    return prefix === '' ? done : `${prefix}\n\n${done}`;
  }

  if (prefix !== '') {
    return `${prefix} Look at the screen to carry on.`;
  }

  const limit = limitReached(session);
  if (limit !== null) {
    await end('limit', limit);
    return `The session has ended: ${limit}. Call finish with your journal.`;
  }

  return null;
}
