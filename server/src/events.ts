import { applyNetwork } from './environment.js';
import type { Session } from './sessions.js';

export interface PlannedEvent {
  type: 'offline' | 'session_expiry';
  /** The event fires just before this action number. */
  atStep: number;
  durationSeconds?: number;
}

export interface FiredEvent {
  type: PlannedEvent['type'];
  step: number;
  detail: string;
  at: string;
}

const EARLIEST_STEP = 2;
const LATEST_OFFLINE_STEP = 10;

function between(random: () => number, [low, high]: [number, number]): number {
  return Math.round(low + random() * (Math.max(high, low) - low));
}

/** Rolls each configured event once per session using the session's seeded randomness. */
export function planEvents(session: Session): PlannedEvent[] {
  const events = session.persona.environment.events ?? {};
  const planned: PlannedEvent[] = [];

  if (events.offline !== undefined && session.random() < events.offline.chance) {
    planned.push({
      type: 'offline',
      atStep: between(session.random, [EARLIEST_STEP, LATEST_OFFLINE_STEP]),
      durationSeconds: between(session.random, events.offline.duration_seconds),
    });
  }

  if (events.session_expiry !== undefined && session.random() < events.session_expiry.chance) {
    planned.push({
      type: 'session_expiry',
      atStep: Math.max(
        EARLIEST_STEP,
        between(session.random, events.session_expiry.after_steps ?? [8, 20]),
      ),
    });
  }

  return planned;
}

/** Fires any event due before the next action. Returns notices the persona would notice. */
export async function beforeAction(session: Session): Promise<void> {
  const step = session.steps + 1;
  const due = session.plannedEvents.filter((event) => event.atStep === step);

  for (const event of due) {
    if (event.type === 'offline') {
      const seconds = event.durationSeconds ?? 10;
      await applyNetwork(session.cdp, 'none');
      session.notices.push('Your signal just dropped. You have no connection.');
      record(session, event.type, step, `offline for ${seconds}s`);

      const restore = setTimeout(() => {
        if (session.status === 'ended' && session.journal !== undefined) return;
        void applyNetwork(session.cdp, session.environment.network)
          .then(() => {
            session.notices.push('Your signal is back.');
            record(session, event.type, session.steps, 'connection restored');
          })
          .catch(() => undefined);
      }, seconds * 1000);
      restore.unref();
    }

    if (event.type === 'session_expiry') {
      await session.context.clearCookies();
      record(session, event.type, step, 'cookies cleared, as when a server session times out');
    }
  }
}

function record(session: Session, type: FiredEvent['type'], step: number, detail: string): void {
  session.firedEvents.push({ type, step, detail, at: new Date().toISOString() });
  session.writer.log(session, `event ${type}: ${detail}`);
}
