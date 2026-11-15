#!/usr/bin/env node
// SubagentStop for persona runners: a runner that started a session must call finish, or the run files are never written.
import { existsSync, readFileSync } from 'node:fs';
import { isRunner, readInput } from './read-input.mjs';

const input = await readInput();
if (!isRunner(input.agent_type) || input.stop_hook_active === true) process.exit(0);

const transcript = input.agent_transcript_path;
if (!transcript || !existsSync(transcript)) process.exit(0);

const calls = new Map();
const failed = new Set();
for (const line of readFileSync(transcript, 'utf8').split('\n')) {
  if (line.trim() === '') continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  for (const block of Array.isArray(entry?.message?.content) ? entry.message.content : []) {
    if (block.type === 'tool_use') calls.set(block.id, String(block.name ?? '').replace(/^mcp__plugin_personaqa_browser__/, ''));
    if (block.type === 'tool_result' && block.is_error === true) failed.add(block.tool_use_id);
  }
}

const succeeded = (name) => [...calls].some(([id, tool]) => tool === name && !failed.has(id));
if (!succeeded('start_session') || succeeded('finish')) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason:
      'You started a PersonaQA session but did not call finish. Call finish now with your first-person journal so the run files are written, then give your final reply.',
  }),
);
