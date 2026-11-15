---
title: Privacy
nav_order: 13
---

# Privacy

PersonaQA is a plugin that runs on your computer, inside Claude Code. It has no servers of its own and collects nothing about you.

## What PersonaQA itself does

| What | Where it goes |
|------|---------------|
| Opens your app in a local headless browser and records what the personas do | Files in your repository under `.personaqa/runs/` (journals, screenshots, traces, reports). Nothing is uploaded |
| Saved logins created with `/personaqa:auth` | `.personaqa/auth/` in your repository, which PersonaQA gitignores |
| Browser and library downloads on first use (Chromium from Playwright's download servers, npm packages from the npm registry) | Your machine, under `~/.claude/plugins/data/` |
| Network requests from the browser | Only to the hosts you list in `app.allowed_domains`; everything else is refused |
| GitHub issues | Only when you run `/personaqa:report file`, through your own `gh` CLI login, after you confirm |

## What goes to Claude

PersonaQA runs inside Claude Code, so the page text, screenshots and run files that personas and agents read are sent to Claude as part of your normal Claude Code usage, under Anthropic's terms and privacy policy and your plan's settings. Point PersonaQA at test environments with test data, never at production or real customer data.

## Questions

Open an issue on [GitHub](https://github.com/phoenix1331/persona-qa/issues).
