---
description: Writes a deterministic Playwright regression test that reproduces a confirmed PersonaQA finding, so the fix can be proven and kept fixed. Use for "/personaqa:test ISSUE-12" or "write a test for that issue".
argument-hint: "<ISSUE-n | persona-mission-n> [--run RUN_ID]"
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(npx playwright test *)
---

# PersonaQA regression test

Exploration is non-deterministic; this turns one confirmed finding into a test that fails now and passes once the problem is fixed. Unlike personas, you may read the codebase here.

## 1. Find the finding

Arguments: `$ARGUMENTS`

- The run is `--run <id>` if given, otherwise the newest folder in `.personaqa/runs/` that has a `report.json`.
- In `report.json`, `ISSUE-n` is the entry in `findings` with that `id`. A session issue id such as `james-checkout-3` is in its session's `issues.json`.
- If the finding is not there, list the available ids and stop.
- If `confirmed.json` in the run folder marks it `dismissed`, say so and stop.

## 2. Gather the evidence

For the finding's evidence sessions, read:

- `run.json`: base URL and device description (match it with a Playwright device, `screen` size and network where it matters)
- `actions.log` up to the issue's `step`: the exact path the persona took. Lines look like `tap e12 button "Pay now"` and `type e9 textbox "Card number" "4242 4242 4242 4242"`: use the role and name for `getByRole` locators
- `issues.json`: what happened and what was expected
- The mission YAML in `.personaqa/missions/`: start URL and test data

## 3. Fit the project

- Use the project's existing Playwright setup: find `playwright.config.*` and its `testDir`, and follow the style of existing specs.
- If there is none, write to `tests/personaqa/` and tell the user to run `npm init playwright@latest` (do not install anything yourself).

## 4. Write the test

Write `<testDir>/personaqa/<issue-id lowercased>.spec.ts`:

- A comment at the top naming the finding and the run it came from.
- `test.use()` for the device or viewport when the finding depends on it (for example `...devices['iPhone 15']` for a mobile-only overlap).
- The shortest path that reproduces it: navigate straight to the right page when that does not change the behaviour, using the persona's actions only where order matters.
- Locators by role and accessible name; never `data-pqa-ref` attributes, which exist only during PersonaQA runs.
- Assert the **expected** behaviour, so the test fails today for the reason in the finding. Examples: Pay is not covered (`await expect(page.getByRole('button', { name: 'Pay now' })).toBeInViewport()` plus an `elementFromPoint` check), the total including fees is shown before payment, focus leaves the date picker on Escape.
- No sleeps; use web-first assertions.

## 5. Check it

If the base URL responds, run `npx playwright test <file>` once. It should fail, and for the right reason. If it passes, the problem may already be fixed or the test does not capture it: say which and adjust.

Reply with the file path, the reproduction in one paragraph, and the test run result.
