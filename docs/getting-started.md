---
title: Getting started
nav_order: 2
---

# Getting started

From nothing to your first report in about ten minutes. You need [Claude Code](https://code.claude.com/docs) and a web app running somewhere a browser can reach: your laptop, a preview deploy or staging.

{: .warning }
Point PersonaQA at **local, preview or staging** sites only, never production. Personas fill in forms, create accounts and pay with test cards.

## 1. Install the plugin

In Claude Code:

```
/plugin marketplace add phoenix1331/persona-qa
/plugin install personaqa@persona-qa
```

Start a new Claude Code session. The first session downloads a headless Chromium (about 290 MB) in the background; it takes about a minute. More detail: [Installation](installation.md).

## 2. Set up your repository

Open Claude Code in your app's repository and run:

```
/personaqa:init http://localhost:8000
```

Use your own URL. This creates:

```
.personaqa/
├── config.yaml                 your app, which personas are on, limits, output
├── missions/first-visit.yaml   a starter mission to edit
└── personas/README.md          how to add your own personas
```

It also adds `.personaqa/runs/` and `.personaqa/auth/` to `.gitignore`. Everything else in `.personaqa/` is meant to be committed, so your team shares the same personas and missions.

If your app loads anything from other hosts that matters to the journey (a payment form, an auth provider), add those hosts to `app.allowed_domains` in `config.yaml`. The browser refuses everything else.

## 3. Write your first mission

Open `.personaqa/missions/first-visit.yaml` and describe one journey people take on your site. For a shop:

```yaml
id: checkout
goal: Buy one adult ticket for Saturday's match and get to the confirmation page.
start_url: /fixtures
time_limit_minutes: 4
success:
  any:
    - url_contains: /order/confirmed
data:
  card: "4242 4242 4242 4242"
  expiry: "12/30"
  cvc: "123"
```

Rename the file to match the `id` (`checkout.yaml`). The `success` rule is checked by the browser after every action, so a persona can never just claim they finished. [Missions](missions.md) explains every field and how to write good rules.

Check your files at any time:

```
/personaqa:validate
```

## 4. Run one persona

```
/personaqa:run james checkout
```

James is 23, on a phone with slow 3G, skims everything and gives up quickly. A few minutes later Claude replies with a summary and links:

```
## PersonaQA: Your App

1 session: 1 reached the goal, 0 gave up, 0 hit a limit, 0 unfinished.

| Persona | Mission  | Outcome | Steps | Longest wait |
|---------|----------|---------|-------|--------------|
| James   | checkout | success | 22    | 15.2s        |

### Top findings
| #       | Severity | Finding                                        | Personas |
| ISSUE-1 | high     | Booking fee charged but not shown before paying | 1        |

Report:     file:///.../.personaqa/runs/2026-11-15T19-23-53/report.html
PDF:        file:///.../report.pdf
Standalone: file:///.../report-standalone.html
```

Open the report with `/personaqa:report open`, or click the link.

## 5. Run the whole cast

```
/personaqa:run all checkout
```

All enabled personas run in parallel (three at a time by default), then two inspectors review the evidence for accessibility and usability problems, and a coordinator merges everything into one ranked report. See [Reading the results](reporting.md).

## 6. Act on what they found

```
/personaqa:report confirm ISSUE-1
/personaqa:report dismiss ISSUE-4 "brand colours, accepted"
/personaqa:test ISSUE-1
/personaqa:report file
```

Confirm what is real, dismiss what is not (later runs remember), turn a finding into a Playwright test that fails until it is fixed, and file confirmed findings as GitHub issues.

## Next steps

- Test pages behind a login: [Logins](authentication.md)
- Make personas that match your users: [Personas](personas.md)
- Run a small set on every pull request: [CI with GitHub Actions](github-actions.md)
