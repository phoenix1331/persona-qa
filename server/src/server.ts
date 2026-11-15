import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type ActionResult, KEYS, back, pressKey, scroll, tap, type } from './actions.js';
import { PersonaQAError } from './errors.js';
import { evaluate, limitReached, patienceNotice } from './mission.js';
import { serverInfo } from './server-info.js';
import type { Session, SessionManager } from './sessions.js';
import { takeSnapshot } from './snapshot.js';

export function createServer(sessions: SessionManager): McpServer {
  const server = new McpServer(serverInfo, {
    instructions:
      'PersonaQA browser. Call start_session with a persona and mission, then act as that person using only these tools. Call finish with your journal when the session ends.',
  });

  server.registerTool(
    'start_session',
    {
      title: 'Start a persona session',
      description:
        'Opens an isolated browser as the persona, loads the mission start page and returns your brief. Use the returned session id with every other tool.',
      inputSchema: {
        persona: z.string().describe('Persona id, e.g. james'),
        mission: z.string().describe('Mission id, e.g. checkout'),
        base_url: z.string().optional().describe('Overrides app.base_url, e.g. a preview deploy'),
      },
    },
    async ({ persona, mission, base_url }) =>
      respond(async () => {
        const session = await sessions.start(
          persona,
          mission,
          base_url === undefined ? {} : { baseUrl: base_url },
        );
        const ended = await evaluate(session, async (outcome, reason) =>
          sessions.end(session, outcome, reason),
        );
        return ended === null ? brief(session) : `${brief(session)}\n\n${ended}`;
      }),
  );

  server.registerTool(
    'look',
    {
      title: 'Look at the screen',
      description:
        'Describes what is on screen now: text, and controls with refs like [e12 button "Pay now"]. Only the visible screen is shown; scroll to see more. If nothing navigated since your last look, only the changes are listed. Ask for a screenshot when layout, colour or images matter.',
      inputSchema: {
        session: z.string(),
        screenshot: z.boolean().optional().describe('Also return an image of the screen'),
      },
    },
    async ({ session: id, screenshot }) =>
      respond(async () => {
        const session = sessions.active(id);
        const limit = limitReached(session);
        if (limit !== null) {
          sessions.end(session, 'limit', limit);
          return `The session has ended: ${limit}. Call finish with your journal.`;
        }
        return view(session, screenshot === true);
      }),
  );

  const act = (id: string, action: (session: Session) => Promise<ActionResult>) =>
    respond(async () => {
      const session = sessions.active(id);
      const result = await action(session);
      session.steps += 1;
      session.lastActionMs = result.durationMs;
      session.longestWaitMs = Math.max(session.longestWaitMs, result.durationMs);

      const patience = patienceNotice(session, result.durationMs);
      if (patience !== null) {
        session.notices.push(patience);
      }

      const seconds = result.durationMs / 1000;
      const waited = seconds >= 1 ? ` The page took ${seconds.toFixed(1)}s to respond.` : '';
      const screen = await view(session, false);
      const ended = await evaluate(session, async (outcome, reason) =>
        sessions.end(session, outcome, reason),
      );
      const text = `${result.summary}${waited}\n\n${screen.text}`;
      return { text: ended === null ? text : `${text}\n\n${ended}` };
    });

  server.registerTool(
    'tap',
    {
      title: 'Tap',
      description:
        'Taps (or clicks) the spot where a control is on screen. If something covers it, whatever is on top gets the tap. Returns the screen afterwards.',
      inputSchema: { session: z.string(), ref: z.string().describe('Ref from look, e.g. e12') },
    },
    async ({ session, ref }) => act(session, (current) => tap(current, ref)),
  );

  server.registerTool(
    'type',
    {
      title: 'Type',
      description:
        'Taps a field if it is not focused, replaces its contents and types the text. You may make typos as you would in real life; the result says what was actually typed.',
      inputSchema: {
        session: z.string(),
        ref: z.string(),
        text: z.string(),
        submit: z.boolean().optional().describe('Press Enter afterwards'),
      },
    },
    async ({ session, ref, text, submit }) =>
      act(session, (current) => type(current, ref, text, submit === true)),
  );

  server.registerTool(
    'press',
    {
      title: 'Press a key',
      description:
        'Presses a keyboard key, e.g. Tab to move focus, Enter to activate, Escape to close.',
      inputSchema: { session: z.string(), key: z.enum(KEYS) },
    },
    async ({ session, key }) => act(session, (current) => pressKey(current, key)),
  );

  server.registerTool(
    'scroll',
    {
      title: 'Scroll',
      description: 'Scrolls the page up or down by a screen (default) or half a screen.',
      inputSchema: {
        session: z.string(),
        direction: z.enum(['up', 'down']),
        amount: z.enum(['screen', 'half']).optional(),
      },
    },
    async ({ session, direction, amount }) =>
      act(session, (current) => scroll(current, direction, amount ?? 'screen')),
  );

  server.registerTool(
    'back',
    {
      title: 'Back',
      description: "Presses the browser's back button.",
      inputSchema: { session: z.string() },
    },
    async ({ session }) => act(session, (current) => back(current)),
  );

  server.registerTool(
    'finish',
    {
      title: 'Finish the session',
      description:
        'Ends the session and records your first-person journal. Call this exactly once, whether the mission succeeded, you gave up or a limit was reached.',
      inputSchema: {
        session: z.string(),
        journal: z
          .string()
          .min(1)
          .describe('First-person account of what happened, in the persona voice'),
      },
    },
    async ({ session: id, journal }) =>
      respond(async () => {
        const session = sessions.get(id);
        if (session.journal !== undefined) {
          throw new PersonaQAError(`Session ${id} is already finished.`);
        }
        session.journal = journal;
        sessions.end(
          session,
          session.outcome ?? 'incomplete',
          session.endReason ?? 'finished by persona',
        );
        await sessions.close(session);

        return [
          `Session ${session.id} finished.`,
          `Outcome: ${session.outcome ?? 'incomplete'} (${session.endReason ?? 'finished by persona'})`,
          `Steps: ${session.steps}`,
          `Duration: ${Math.round((Date.now() - session.startedAt) / 1000)}s`,
        ].join('\n');
      }),
  );

  return server;
}

export interface Reply {
  text: string;
  image?: Buffer;
}

export async function respond(action: () => Promise<string | Reply>): Promise<CallToolResult> {
  try {
    const result = await action();
    const reply = typeof result === 'string' ? { text: result } : result;
    const content: CallToolResult['content'] = [{ type: 'text', text: reply.text }];
    if (reply.image !== undefined) {
      content.push({ type: 'image', data: reply.image.toString('base64'), mimeType: 'image/jpeg' });
    }
    return { content };
  } catch (error) {
    const message = error instanceof PersonaQAError ? error.describe() : (error as Error).message;
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

export function brief(session: Session): string {
  const { persona, mission } = session;
  const traits = Object.entries(persona.traits)
    .map(([key, value]) => `- ${key.replaceAll('_', ' ')}: ${String(value)}`)
    .join('\n');
  const data = Object.entries(mission.data ?? {})
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n');

  return [
    `Session: ${session.id}`,
    '',
    `## You are ${persona.name}${persona.age === undefined ? '' : `, ${persona.age}`}`,
    persona.bio.trim(),
    '',
    '### How you behave',
    traits,
    persona.voice === undefined ? '' : `\nVoice: ${persona.voice.trim()}`,
    '',
    `### Your device\n${session.environment.description}. The browser enforces this; you cannot change it.`,
    session.environment.input === 'keyboard_only'
      ? 'You never use a mouse or touch: tap is not available to you. Use press (Tab, Enter, Space, arrows) and type into the focused field.'
      : '',
    '',
    '## Your mission',
    mission.goal.trim(),
    mission.context === undefined ? '' : `\n${mission.context.trim()}`,
    data === '' ? '' : `\nDetails you have to hand:\n${data}`,
    '',
    'The page is open. Take a look before acting.',
  ]
    .filter((line, index, lines) => !(line === '' && lines[index - 1] === ''))
    .join('\n');
}

/** How long look waits for a loading page to settle before describing it anyway. */
const SETTLE_MS = 1500;

/** Notices first (they are what a person would notice first), then the snapshot. */
export async function view(session: Session, screenshot: boolean): Promise<Reply> {
  await session.page.waitForLoadState('load', { timeout: SETTLE_MS }).catch(() => undefined);
  const notices = session.notices.splice(0).map((notice) => `Notice: ${notice}`);
  const snapshot = await takeSnapshot(session.page, session.snapshot);
  const text = [...notices, snapshot.text].join('\n');

  if (!screenshot) {
    return { text };
  }

  return { text, image: await session.page.screenshot({ type: 'jpeg', quality: 60 }) };
}
