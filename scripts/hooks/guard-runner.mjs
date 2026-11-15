#!/usr/bin/env node
// PreToolUse safety net: a persona runner may only use the PersonaQA browser tools, so runs stay black box.
import { isRunner, readInput } from './read-input.mjs';

const input = await readInput();
const tool = String(input.tool_name ?? '');

if (!isRunner(input.agent_type) || tool.startsWith('mcp__plugin_personaqa_browser__')) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `PersonaQA personas are black box users: ${tool} is not available. Use only the PersonaQA browser tools (look, tap, type, press, scroll, back, record_issue, give_up, finish).`,
    },
  }),
);
