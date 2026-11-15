import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Loader } from './loader.js';
import { createServer } from './server.js';
import { SessionManager } from './sessions.js';

export { serverInfo } from './server-info.js';

const pluginRoot =
  process.env['PERSONAQA_PLUGIN_ROOT'] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectDir =
  process.env['PERSONAQA_PROJECT_DIR'] ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

const sessions = new SessionManager({
  loader: () => new Loader({ projectDir, builtinPersonaDir: join(pluginRoot, 'personas') }),
  headless: process.env['PERSONAQA_HEADED'] !== '1',
});

const server = createServer(sessions);

async function shutdown(): Promise<void> {
  await sessions.shutdown();
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('close', () => void shutdown());

await server.connect(new StdioServerTransport());
