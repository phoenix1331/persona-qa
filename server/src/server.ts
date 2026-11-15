import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PersonaQAError } from './errors.js';
import { serverInfo } from './server-info.js';
import type { Session, SessionManager } from './sessions.js';

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
        return brief(session);
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
        session.journal = journal;
        await sessions.end(
          session,
          session.outcome ?? 'incomplete',
          session.endReason ?? 'finished by persona',
        );

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

export async function respond(action: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await action() }] };
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
