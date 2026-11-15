---
description: Checks PersonaQA config, personas and missions in .personaqa/ against the schemas and lists every problem. Use after editing persona or mission files, before a run, or when a run fails to start.
allowed-tools: mcp__plugin_personaqa_browser__validate_project
---

# PersonaQA validate

1. Call `validate_project`. It checks `.personaqa/config.yaml`, every persona (your own and the built-ins, with `extends` applied) and every mission, plus names in `personas.enabled` and `ci` sets.
2. Show the result as it came back, keeping the `ok` / `FAIL` lines and the path and message under each failure.
3. For each failure, add one plain sentence on how to fix it, based only on the message (for example "`reading` must be `skims`, `reads` or `scrutinises`").
4. If everything passed, say so in one line.

Do not edit files unless the user asks. A persona that fails validation cannot run.
