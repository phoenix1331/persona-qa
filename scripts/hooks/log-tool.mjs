#!/usr/bin/env node
// PostToolUse on the PersonaQA browser tools: appends what Claude sent and how long it took, for debugging runs.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readInput } from './read-input.mjs';

const input = await readInput();
const project = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
if (!project || !existsSync(join(project, '.personaqa'))) process.exit(0);

const clip = (value) => (typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value);
const args = Object.fromEntries(Object.entries(input.tool_input ?? {}).map(([key, value]) => [key, clip(value)]));
const response = input.tool_response;
const isError = Array.isArray(response) ? false : response?.isError === true;

const dir = join(project, '.personaqa', 'runs');
mkdirSync(dir, { recursive: true });
appendFileSync(
  join(dir, 'tool-calls.jsonl'),
  `${JSON.stringify({
    at: new Date().toISOString(),
    agent: input.agent_type ?? 'main',
    tool: String(input.tool_name ?? '').replace(/^mcp__plugin_personaqa_browser__/, ''),
    session: args.session ?? null,
    args,
    duration_ms: input.duration_ms ?? null,
    error: isError,
  })}\n`,
);
