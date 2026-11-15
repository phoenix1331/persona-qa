---
title: Cost and usage
nav_order: 6.5
---

# Cost and usage

Dollar figures in these docs are **what the tokens would cost at Claude API rates**, measured on the demo app. What you actually pay depends on how you use Claude Code and which model runs the personas.

## What it means for you

| How you run Claude Code | What a run costs you |
|-------------------------|----------------------|
| **Pro or Max plan** | No per-run charge. Runs count towards your plan's usage limits like any other Claude Code work. Persona runs are agent-heavy, so a full cast uses noticeably more of your allowance than a chat would |
| **API key** (pay as you go, typical in CI) | Billed per token, so the dollar figures below are a fair guide to your bill |
| **Team or Enterprise plans, Bedrock, Vertex, Foundry** | Whatever your agreement charges for the same tokens |

## How the figures were measured

Every figure comes from a real run against the demo ticket shop, started headless with:

```bash
claude -p "/personaqa:run james,margaret,priya,tomasz,chaos checkout" --output-format json
```

The JSON output includes `total_cost_usd`: Claude Code's own estimate of what the run's tokens (input, output, cache writes and cache reads, across the main session and every subagent) would cost at API prices. All runs below used **Sonnet** for the persona runners, the inspectors, the coordinator and the main session.

| Run | Measured |
|-----|----------|
| One persona, checkout, browser server only (no plugin, no inspectors) | $0.14 |
| One persona, checkout, through the plugin with the coordinator | $0.20 |
| One persona, checkout, with both inspectors and the coordinator | $0.66 |
| Five personas, checkout, with both inspectors and the coordinator | $1.40 and $1.54 (two runs) |
| `/personaqa:auth` (sign in once and save the login) | $0.16 |
| For comparison: one persona on the stock Playwright MCP, before PersonaQA's server existed | $0.24 |

These are single measurements on one small app, not averages. Treat them as an order of magnitude.

## What changes the cost

| Factor | Effect |
|--------|--------|
| **Model** | The biggest lever. Set `runner.model` in the config (for example `haiku`) for persona runners; smaller models cost a fraction as much per token, larger ones more. Check current prices on Anthropic's pricing page. Compare the quality of findings before switching: a cheaper model that finds fewer problems is not cheaper |
| **Personas x missions** | Each pair is one run. A pull request set of two runs costs about a fifth of a five-persona cast |
| **Mission length** | Every step re-reads the conversation so far, so long journeys cost more than short ones. `max_steps` caps it |
| **Page size** | Snapshots show only the visible screen, but busy pages still mean more tokens per look |
| **Screenshots** | Personas ask for one only when layout matters; each adds image tokens |
| **Inspectors** | The accessibility and UX inspectors each read every session's evidence. `--no-inspectors` skips them |
| **Retries and struggle** | A persona fighting a broken flow takes more steps, which is exactly the run you want to see |

## Measuring your own runs

- **Headless or CI:** run with `--output-format json` and read `total_cost_usd`.
- **Each report** shows a "runner tokens" tile: the tokens Claude Code reported for the persona runners. It is a guide to relative size between runs, not a bill.
- **On a subscription,** keep an eye on your plan's usage limits in your Claude account.

## Keeping it down

- Run two or three personas on pull requests and the full cast nightly. See [CI with GitHub Actions](github-actions.md).
- Try `runner.model: haiku` for persona runners and compare the findings.
- Keep `screenshots: on_issue` (the default) and sensible `max_steps`.
- Use `--no-inspectors` for quick checks, and `/personaqa:audit` (no personas) for a fast accessibility pass.
