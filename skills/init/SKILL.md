---
description: "Sets up PersonaQA in the current repository: creates .personaqa/ with config, a starter mission and a personas folder, and gitignores run output. Use when PersonaQA is not set up yet or the user asks to initialise it."
argument-hint: "[base-url]"
allowed-tools: Read, Glob, AskUserQuestion, Write(.personaqa/**), Write(.gitignore), Edit(.gitignore), mcp__plugin_personaqa_browser__validate_project
---

# PersonaQA init

## 1. Check

If `.personaqa/config.yaml` already exists, say so, suggest `/personaqa:validate`, and stop. Never overwrite it.

## 2. Gather

- **Base URL:** from `$ARGUMENTS` if given, otherwise ask. It must be a staging, preview or local URL, never production. Personas submit forms and pay with test cards.
- **App name:** default to the repository folder name.
- **Personas to enable:** ask which built-ins to switch on (multi-select), describing each in a few words:
  - `james`: phone, slow 3G, impatient skimmer
  - `margaret`: iPad, large text, reads everything, wary of payments
  - `priya`: keyboard only, notices focus problems
  - `tomasz`: Android, Polish locale, English as a second language
  - `chaos`: tries to break forms
- **Success path:** ask for a URL path that proves the starter mission's goal was reached (for example `/signup/complete`). If the user is unsure, use `/replace-with-your-success-path` so the mission cannot pass until it is edited (`/` would pass immediately).

When running non-interactively, use the argument for the base URL, the folder name, all five personas and `/replace-with-your-success-path`.

## 3. Write the files

Copy from `${CLAUDE_PLUGIN_ROOT}/templates/init/`, filling every `{{PLACEHOLDER}}`:

| Template | Write to | Placeholders |
|----------|----------|--------------|
| `config.yaml` | `.personaqa/config.yaml` | `{{APP_NAME}}`, `{{BASE_URL}}`, `{{HOST}}` (host and port of the base URL), `{{PERSONAS}}` (comma-separated ids), `{{FIRST_PERSONA}}` |
| `missions/first-visit.yaml` | `.personaqa/missions/first-visit.yaml` | `{{SUCCESS_PATH}}` |
| `personas/README.md` | `.personaqa/personas/README.md` | none |

## 4. Gitignore

Add these lines to the repository's `.gitignore` (create it if missing; do not duplicate existing lines):

```
.personaqa/runs/
.personaqa/auth/
```

Everything else in `.personaqa/` is meant to be committed and shared with the team.

## 5. Validate and hand over

Call `validate_project` and show the result. Then tell the user, briefly:

1. Edit `.personaqa/missions/first-visit.yaml` (goal and success rule) and add missions for key journeys.
2. Try it: `/personaqa:run james first-visit`.
3. If the app needs a login, set `auth` in the config (stored login state goes in `.personaqa/auth/`, which is gitignored).
