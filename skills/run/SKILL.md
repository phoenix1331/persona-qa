---
description: Runs PersonaQA personas (realistic simulated users) through missions on your app in a real browser and reports what they hit. Use when asked to run personas or the cast, QA a flow "as a user", or e.g. "get James to try checkout".
argument-hint: "[personas|all] [missions|all] [--set NAME] [--base-url URL]"
allowed-tools: mcp__plugin_personaqa_browser__plan_run, Agent, Read, Glob
---

# PersonaQA run

Run persona x mission sessions in parallel and summarise the outcome. The browser server enforces each persona's device and network, checks mission success and writes the run files. You orchestrate; you never drive the browser yourself.

## 1. Read the request

Arguments: `$ARGUMENTS`

| Form | Meaning |
|------|---------|
| (empty) | Personas from `personas.enabled` in `.personaqa/config.yaml`, every mission |
| `james checkout` | One persona, one mission |
| `james,priya checkout` | Comma-separated lists; `all` means every persona or mission |
| `--set pull_request` | A named run set from `ci` in the config |
| `--base-url https://pr-12.example.test` | Run against another deploy of the same app |

Plain English maps to the same fields: "James and Margaret on checkout" is `james,margaret checkout`. The first bare word is personas, the second missions.

## 2. Plan

Call `plan_run` with `personas`, `missions`, `set` and `base_url` as parsed (omit what was not given). If it returns an error, show the error to the user with the file and field it names, and stop. Do not guess or fix files yourself.

Show the plan in one short table: persona, device and network, missions. Do not ask for confirmation; runs must work unattended in CI.

## 3. Dispatch the runners

Start `personaqa:persona-runner` subagents with the Agent tool, one per pair in `pairs`. Send up to `max_parallel` Agent calls in a single message so they run in parallel; when a batch finishes, start the next. If the plan has a `model`, pass it as the Agent `model`.

Give each runner exactly this prompt, filled in:

```
Persona: <persona>
Mission: <mission>
run_id: <run_id>
base_url: <base_url>
Call start_session with these values, play the persona through the mission, then finish.
```

## 4. Summarise

When every runner has replied, read each `run.json` under `.personaqa/runs/<run_id>/` (use Glob to find them). Use those files for facts; runner replies and journals are the persona's view, not the record.

Reply with:

1. A table: persona, mission, outcome, steps, longest wait, patience breaches.
2. The main problems the personas hit, merged where the same problem came up more than once, most serious first, each naming who hit it.
3. The run folder path, and that each session folder holds `journal.md`, screenshots and (per config) a Playwright trace (`npx playwright show-trace <path>/trace.zip`).

Keep it under 300 words. Outcomes come only from `run.json`, never from your own judgement.
