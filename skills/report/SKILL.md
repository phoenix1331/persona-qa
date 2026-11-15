---
description: Opens or rebuilds a PersonaQA run report, records confirm or dismiss decisions on findings (remembered across runs), and files confirmed findings as GitHub issues. Use for "/personaqa:report", "dismiss ISSUE-3", "file the findings to GitHub".
argument-hint: "[run-id] | confirm ISSUE-n... | dismiss ISSUE-n \"reason\" | file [ISSUE-n...] [--yes]"
allowed-tools: Read, Glob, AskUserQuestion, Bash(node *), Bash(gh issue *), Bash(gh label *)
---

# PersonaQA report

Arguments: `$ARGUMENTS`

The run folder is the newest folder in `.personaqa/runs/` that has `run.json` session files, unless the arguments start with a run id. All helpers live in `${CLAUDE_PLUGIN_ROOT}/scripts/`. Decisions are stored in `.personaqa/triage.json`; tell the user to commit it so the whole team shares them.

## Open (no sub-command, or only a run id)

1. If the folder has no `report.html`, or `findings.json` is newer than it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs" "<run folder>"`.
2. Reply with `summary.md`, the path to `report.html`, and the commands below in one short list.

## confirm ISSUE-n...

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/triage.mjs" confirm "<run folder>" ISSUE-n ...`, then re-run `report.mjs`. Confirmed findings are ready to file and to turn into tests with `/personaqa:test ISSUE-n`.

## dismiss ISSUE-n "reason"

A reason is required; ask for one if missing. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/triage.mjs" dismiss "<run folder>" ISSUE-n <reason>`, then re-run `report.mjs`. Explain that later runs will hide the same finding.

## file [ISSUE-n...] [--yes]

Files findings as GitHub issues with the `gh` CLI.

1. Read `.personaqa/config.yaml`: use `issues.github.labels` (default `personaqa`) and `issues.github.min_severity` (default `medium`).
2. Get the candidates as JSON: `node "${CLAUDE_PLUGIN_ROOT}/scripts/triage.mjs" github "<run folder>" --labels <labels> --min-severity <min>` plus the ids if given. With no ids this returns confirmed findings only; add `--all` when `issues.sink` is `github` (the unattended nightly case). Dismissed and already filed findings are never returned.
3. If there are none, say so and stop.
4. Unless `--yes` was given, show the titles and labels and ask the user to confirm before creating anything: issues are public to everyone with access to the repository.
5. For each candidate: skip it if an open issue already has the same title (`gh issue list --state open --label personaqa --search "<title> in:title" --json number,title`); `triage.json` is not always committed back from CI, so this is the check that prevents nightly duplicates. Otherwise make sure its labels exist (`gh label create <name> --force` is safe to repeat), then `gh issue create --title "<title>" --label "<labels joined by commas>" --body "<body>"`. Pass the body exactly as given.
6. Record each one: `node "${CLAUDE_PLUGIN_ROOT}/scripts/triage.mjs" filed "<run folder>" ISSUE-n <issue url>`, then re-run `report.mjs`.
7. Reply with the issue links.

If `gh` is missing or not signed in, say so and stop; suggest `gh auth login`.
