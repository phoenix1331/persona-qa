---
description: Runs a quick accessibility sweep of your app's mission pages with no personas: automated axe-core WCAG scans plus the accessibility inspector's review. Use for "audit accessibility", "check WCAG", or a fast pre-release a11y check.
argument-hint: "[missions|all] [--base-url URL] [--max-pages N]"
allowed-tools: mcp__plugin_personaqa_browser__sweep, Agent, Read, Bash(node *)
---

# PersonaQA accessibility sweep

A sweep scans pages without any persona. It is quick and costs no persona runs, but it only sees what is reachable by following links from each mission's start page. Persona runs (`/personaqa:run`) find the problems people actually suffer; a sweep finds the problems that are there.

## 1. Read the request

Arguments: `$ARGUMENTS`

| Form | Meaning |
|------|---------|
| (empty) or `all` | Every mission's start page |
| `checkout,signup` | Only these missions |
| `--base-url https://pr-12.example.test` | Another deploy of the same app |
| `--max-pages 30` | Pages per mission (default 15, maximum 50) |

## 2. Sweep

Call `sweep` with `missions`, `base_url` and `max_pages` as parsed. It returns `run_id`, the run `folder` and pages scanned per mission. If it errors, show the error and stop.

## 3. Review

Start one `personaqa:a11y-inspector` subagent with the prompt `Run folder: <folder>`. It merges the scans, adds the manual-style checks and writes `a11y.json`.

## 4. Report

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs" "<folder>"`, then read `<folder>/summary.md`.

Reply with the summary, the inspector's top findings and the path to `report.html` (Accessibility tab). Always add: automated and evidence-based checks cover only part of WCAG; they complement, not replace, an audit with assistive technology users.
