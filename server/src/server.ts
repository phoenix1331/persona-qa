import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type ActionResult, KEYS, back, pressKey, scroll, tap, type } from './actions.js';
import { PersonaQAError } from './errors.js';
import { evaluate, limitReached, patienceNotice } from './mission.js';
import { resolveEnvironment } from './environment.js';
import { plan } from './plan.js';
import { beforeAction } from './events.js';
import { auditState, formatScan, rideAlong } from './audit.js';
import { sweep } from './sweep.js';
import { recordIssue } from './issues.js';
import { formatReport, validateProject } from './validate-project.js';
import { serverInfo } from './server-info.js';
import type { Session, SessionManager } from './sessions.js';
import { describeRef, takeSnapshot } from './snapshot.js';

export function createServer(sessions: SessionManager): McpServer {
  const server = new McpServer(serverInfo, {
    instructions:
      'PersonaQA browser. Call start_session with a persona and mission, then act as that person using only these tools. Call finish with your journal when the session ends.',
  });

  server.registerTool(
    'plan_run',
    {
      title: 'Plan a PersonaQA run',
      description:
        'For the orchestrating session, not personas. Validates config, personas and missions and returns the persona x mission pairs to run, a shared run_id, base_url and max_parallel as JSON.',
      inputSchema: {
        personas: z
          .string()
          .optional()
          .describe('"all", comma-separated ids, or omit for config personas.enabled'),
        missions: z
          .string()
          .optional()
          .describe('"all", comma-separated ids, or omit for all missions'),
        set: z.string().optional().describe('Named run set from config ci, e.g. pull_request'),
        base_url: z.string().optional(),
      },
    },
    async (input) =>
      respond(async () => {
        const loader = sessions.loader();
        const result = plan(
          loader,
          {
            ...(input.personas === undefined ? {} : { personas: input.personas }),
            ...(input.missions === undefined ? {} : { missions: input.missions }),
            ...(input.set === undefined ? {} : { set: input.set }),
            ...(input.base_url === undefined ? {} : { base_url: input.base_url }),
          },
          (id) => resolveEnvironment(loader.persona(id).environment).description,
        );
        return JSON.stringify(result, null, 2);
      }),
  );

  server.registerTool(
    'audit',
    {
      title: 'Accessibility scan',
      description:
        'For inspectors and sweeps, not personas. Runs an automated axe-core WCAG scan of the current page state and records it in the session a11y.json.',
      inputSchema: { session: z.string() },
    },
    async ({ session: id }) =>
      respond(async () => {
        const session = sessions.get(id);
        if (session.page.isClosed()) {
          throw new PersonaQAError(`Session ${id} is closed.`);
        }
        return formatScan(await auditState(session, true));
      }),
  );

  server.registerTool(
    'sweep',
    {
      title: 'Accessibility sweep',
      description:
        'For the orchestrating session, not personas. Scans each mission start page and the same-site pages it links to (one per path) with axe-core, with no persona, and writes a run folder for the a11y inspector.',
      inputSchema: {
        missions: z
          .string()
          .optional()
          .describe('"all" or comma-separated mission ids; omit for all'),
        base_url: z.string().optional(),
        max_pages: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Pages per mission, default 15'),
      },
    },
    async ({ missions, base_url, max_pages }) =>
      respond(async () => {
        const ids =
          missions === undefined || missions.trim() === '' || missions.trim() === 'all'
            ? undefined
            : missions
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id !== '');
        const result = await sweep(sessions, {
          ...(ids === undefined ? {} : { missions: ids }),
          ...(base_url === undefined ? {} : { base_url }),
          ...(max_pages === undefined ? {} : { max_pages }),
        });
        return JSON.stringify(result, null, 2);
      }),
  );

  server.registerTool(
    'validate_project',
    {
      title: 'Validate PersonaQA files',
      description:
        'For the orchestrating session, not personas. Checks .personaqa/config.yaml, every persona (including built-ins and extends) and every mission against the schemas, and lists all problems.',
      inputSchema: {},
    },
    async () => respond(async () => formatReport(validateProject(sessions.loader()))),
  );

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
        save_login: z
          .boolean()
          .optional()
          .describe('For /personaqa:auth: save the login when the mission succeeds'),
        run_id: z
          .string()
          .regex(/^[A-Za-z0-9T:._-]+$/)
          .optional()
          .describe('Shared id so parallel sessions write into one run folder'),
      },
    },
    async ({ persona, mission, base_url, run_id, save_login }) =>
      respond(async () => {
        const session = await sessions.start(persona, mission, {
          ...(base_url === undefined ? {} : { baseUrl: base_url }),
          ...(run_id === undefined ? {} : { runId: run_id.replaceAll(':', '-') }),
          ...(save_login === true ? { saveLogin: true } : {}),
        });
        await rideAlong(session);
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
          session.writer.log(session, `end limit: ${limit}`);
          return `The session has ended: ${limit}. Call finish with your journal.`;
        }
        session.writer.log(session, `look${screenshot === true ? ' +screenshot' : ''}`);
        return view(session, screenshot === true);
      }),
  );

  const act = (
    id: string,
    name: string,
    detail: string | ((session: Session) => string),
    action: (session: Session) => Promise<ActionResult>,
  ) =>
    respond(async () => {
      const session = sessions.active(id);
      const described = typeof detail === 'string' ? detail : detail(session);
      await beforeAction(session);
      const result = await action(session);
      session.steps += 1;
      session.lastActionMs = result.durationMs;
      session.longestWaitMs = Math.max(session.longestWaitMs, result.durationMs);
      session.writer.log(
        session,
        `${name} ${described} (${(result.durationMs / 1000).toFixed(1)}s) ${session.page.url()} :: ${result.summary}`,
      );
      await session.writer.afterAction(session, name);

      const patience = patienceNotice(session, result.durationMs);
      if (patience !== null) {
        session.notices.push(patience);
        session.writer.log(session, `patience ${patience}`);
      }

      const seconds = result.durationMs / 1000;
      const waited = seconds >= 1 ? ` The page took ${seconds.toFixed(1)}s to respond.` : '';
      const screen = await view(session, false);
      await rideAlong(session);
      const ended = await evaluate(session, async (outcome, reason) => {
        sessions.end(session, outcome, reason);
        session.writer.log(session, `end ${outcome}: ${reason}`);
      });
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
    async ({ session, ref }) =>
      act(
        session,
        'tap',
        (current) => withTarget(current, ref),
        (current) => tap(current, ref),
      ),
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
      act(
        session,
        'type',
        (current) =>
          `${withTarget(current, ref)} ${JSON.stringify(text)}${submit === true ? ' +Enter' : ''}`,
        (current) => type(current, ref, text, submit === true),
      ),
  );

  server.registerTool(
    'press',
    {
      title: 'Press a key',
      description:
        'Presses a keyboard key, e.g. Tab to move focus, Enter to activate, Escape to close.',
      inputSchema: { session: z.string(), key: z.enum(KEYS) },
    },
    async ({ session, key }) => act(session, 'press', key, (current) => pressKey(current, key)),
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
      act(session, 'scroll', `${direction} ${amount ?? 'screen'}`, (current) =>
        scroll(current, direction, amount ?? 'screen'),
      ),
  );

  server.registerTool(
    'back',
    {
      title: 'Back',
      description: "Presses the browser's back button.",
      inputSchema: { session: z.string() },
    },
    async ({ session }) => act(session, 'back', '', (current) => back(current)),
  );

  server.registerTool(
    'record_issue',
    {
      title: 'Record an issue',
      description:
        'Logs a problem you hit, against the current step. The browser attaches a screenshot, the URL and the time. Record each distinct problem once, when it happens.',
      inputSchema: {
        session: z.string(),
        title: z
          .string()
          .min(3)
          .max(120)
          .describe('Short, specific: "Pay button hidden under cookie banner"'),
        severity: z
          .enum(['low', 'medium', 'high', 'critical'])
          .describe(
            'critical: blocks the mission for everyone; high: blocked or nearly lost you; medium: slowed or confused you; low: annoyance',
          ),
        what_happened: z.string().min(3),
        expected: z.string().min(3),
      },
    },
    async ({ session: id, ...issue }) =>
      respond(async () => {
        const session = sessions.get(id);
        if (session.journal !== undefined) {
          throw new PersonaQAError(`Session ${id} is finished; issues can no longer be added.`);
        }
        const recorded = await recordIssue(session, issue);
        return `Recorded ${recorded.id} (${recorded.severity}): ${recorded.title}${recorded.screenshot === undefined ? '' : ` with ${recorded.screenshot}`}.`;
      }),
  );

  server.registerTool(
    'give_up',
    {
      title: 'Give up',
      description:
        'Abandon the mission, as the person would. Say why in their words. Then call finish with your journal.',
      inputSchema: { session: z.string(), reason: z.string().min(3) },
    },
    async ({ session: id, reason }) =>
      respond(async () => {
        const session = sessions.active(id);
        sessions.end(session, 'abandoned', `gave up: ${reason}`);
        session.writer.log(session, `give_up ${reason}`);
        return 'You gave up. Call finish with your journal.';
      }),
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
        session.writer.log(session, `finish ${session.outcome ?? 'incomplete'}`);
        const files = await session.writer.complete(session);
        await sessions.close(session);

        return [
          `Session ${session.id} finished.`,
          `Outcome: ${session.outcome ?? 'incomplete'} (${session.endReason ?? 'finished by persona'})`,
          `Steps: ${session.steps}`,
          `Duration: ${Math.round((Date.now() - session.startedAt) / 1000)}s`,
          `Run files: ${files.join(', ')}`,
        ].join('\n');
      }),
  );

  return server;
}

function withTarget(session: Session, ref: string): string {
  const target = describeRef(session.snapshot, ref);
  return target === null ? ref : `${ref} ${target}`;
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
  const credentials = session.auth.credentials;
  const data = Object.entries({
    ...(credentials === undefined
      ? {}
      : { 'your email': credentials.email, 'your password': credentials.password }),
    ...(mission.data ?? {}),
  })
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n');
  const login = session.auth.phase === 'login' ? session.auth.loginMission : undefined;

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
    login === undefined
      ? ''
      : `First you need to sign in: ${login.goal.trim()} The browser will tell you when you are signed in.\n\nThen:`,
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
