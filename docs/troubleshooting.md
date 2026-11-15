---
title: Troubleshooting
nav_order: 10
---

# Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| "PersonaQA is still installing the browser" | The first session after install downloads Chromium in the background. Wait a minute and run again. Progress is in `~/.claude/plugins/data/personaqa-persona-qa/setup.log` |
| "Chromium is not installed yet" and `setup.log` shows an error | The download failed (often a proxy). Start a new session to retry. On Linux, also run `npx playwright install-deps chromium` once (needs sudo) |
| "No config found ... Run /personaqa:init first" | Run `/personaqa:init` in the repository root, or open Claude Code in the folder that holds `.personaqa/` |
| "environment variable X is not set" | The config uses `${X}`; export it, or give a default with `${X:-value}` |
| "Mission start URL ... is outside app.allowed_domains" | Add the host (with port, if it has one) to `app.allowed_domains` |
| Personas say a page is blank or a link "did nothing" | The page needs a host that is not in `allowed_domains` (an API, a CDN, a payment form). The run's `run.json` lists `blocked_requests` |
| "No saved login at ..." | Run `/personaqa:auth`, or see [Logins](authentication.md) for sites with single sign-on or two-factor codes |
| Personas land on the sign-in page | The saved login has expired. Run `/personaqa:auth` again |
| Every session ends as `limit` | Steps or minutes ran out. Read a journal first: the journey may be genuinely too long or confusing. Otherwise raise `max_steps` or `time_limit_minutes` on the mission |
| A session succeeds immediately | The mission's success rule already passes on the start page; make it more specific. See [Missions](missions.md) |
| A finding is wrong or accepted | `/personaqa:report dismiss ISSUE-n "reason"`; later runs hide it |
| The report has no Download PDF button | Exporting needs the plugin's browser. Run `/personaqa:report export` to see the error |
| Emoji show as boxes in screenshots | The headless browser has no emoji font. It does not affect what personas do or see in text |
| Runs cost more than expected | Use fewer personas on pull requests, `runner.model: haiku`, lower `max_steps_per_run`, and `screenshots: on_issue`. The billed cost is `total_cost_usd` in `claude -p --output-format json` |

Still stuck? Open an issue on [GitHub](https://github.com/phoenix1331/persona-qa/issues) with the run's `run.json` and `actions.log` (remove anything sensitive first).
