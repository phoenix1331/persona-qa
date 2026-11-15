---
description: Runs PersonaQA personas (realistic simulated users) through missions on your app in a real browser and reports what they hit. Use when asked to run personas or the cast, QA a flow "as a user", or e.g. "get James to try checkout".
argument-hint: "[personas|all] [missions|all] [--set NAME] [--base-url URL] [--with a11y|ux] [--no-inspectors]"
allowed-tools: mcp__plugin_personaqa_browser__plan_run, Agent, Read, Glob, Write, Bash(node *)
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
| `--with a11y` | Only this inspector rides along (`a11y` or `ux`; repeatable) |
| `--no-inspectors` | Personas only, no inspectors |

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

## 4. Record usage

Each Agent result reports the subagent's token usage (for example `total_tokens`). Write `.personaqa/runs/<run_id>/usage.json` as a JSON array with one entry per runner:

```json
[{ "persona": "james", "mission": "checkout", "model": "sonnet", "total_tokens": 123456 }]
```

Use the model you passed, or `sonnet` (the runner default). If a result shows no token count, leave that runner out.

## 5. Inspectors

Inspectors are on when `inspectors` in the plan says so, narrowed by `--with` (only the named ones) or `--no-inspectors` (none). Start the ones that are on in parallel, in one message, each with the prompt `Run folder: .personaqa/runs/<run_id>/`:

| Inspector | Agent | Writes |
|-----------|-------|--------|
| a11y | `personaqa:a11y-inspector` | `a11y.json` (Accessibility tab) |

Wait for them before the coordinator.

## 6. Coordinate and report

Start one `personaqa:coordinator` subagent with the prompt `Run folder: .personaqa/runs/<run_id>/`. It merges the issues into ranked findings and writes `summary.md` and `report.html`.

Then read `.personaqa/runs/<run_id>/summary.md` and reply with its contents, followed by the path to `report.html` and a note that each session folder holds `journal.md`, screenshots and (per config) a Playwright trace (`npx playwright show-trace <path>/trace.zip`).

If the coordinator fails, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs" .personaqa/runs/<run_id>/` yourself (it reports unmerged issues) and say that the findings were not merged.

Outcomes come only from `run.json`, never from your own judgement.
