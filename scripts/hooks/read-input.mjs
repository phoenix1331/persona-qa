// Shared by the hook scripts: reads the hook's JSON input from stdin.
export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export const isRunner = (agentType) => /^(personaqa:)?persona-runner$/.test(agentType ?? '');
