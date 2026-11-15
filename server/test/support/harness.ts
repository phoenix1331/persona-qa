import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Loader } from '../../src/loader.js';
import { createServer } from '../../src/server.js';
import { SessionManager } from '../../src/sessions.js';

export const persona = (id = 'james', extra = ''): string => `
id: ${id}
name: James
age: 23
bio: Bus commuter on his phone.
environment:
  preset: desktop-fast
traits:
  patience_seconds: 8
  reading: skims
  tech_confidence: high
voice: Casual.
${extra}`;

export interface Project {
  dir: string;
  builtins: string;
  write: (path: string, contents: string) => void;
}

export function makeProject(baseUrl: string, allowed: string[], missionYaml: string): Project {
  const root = mkdtempSync(join(tmpdir(), 'personaqa-server-'));
  const dir = join(root, 'app');
  const builtins = join(root, 'plugin', 'personas');

  const write = (path: string, contents: string): void => {
    const full = path.startsWith('builtin:') ? join(builtins, path.slice(8)) : join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  write(
    '.personaqa/config.yaml',
    `version: 1\napp:\n  name: Test\n  base_url: ${baseUrl}\n  allowed_domains: [${allowed.join(', ')}]\n`,
  );
  write('.personaqa/missions/checkout.yaml', missionYaml);
  write('builtin:james.yaml', persona());

  return { dir, builtins, write };
}

export async function connect(project: Project): Promise<{
  client: Client;
  sessions: SessionManager;
  call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ text: string; isError: boolean }>;
  close: () => Promise<void>;
}> {
  const sessions = new SessionManager({
    loader: () => new Loader({ projectDir: project.dir, builtinPersonaDir: project.builtins }),
  });
  const server = createServer(sessions);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return {
      text: content
        .filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('\n'),
      isError: result.isError === true,
    };
  };

  return {
    client,
    sessions,
    call,
    close: async () => {
      await sessions.shutdown();
      await client.close();
      await server.close();
    },
  };
}

export function sessionIdFrom(text: string): string {
  const match = /^Session: (\S+)/m.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`No session id in:\n${text}`);
  }
  return match[1];
}
