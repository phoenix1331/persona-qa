# Prototype findings: stock Playwright MCP

Before writing any server code, James (23, phone, patchy signal, impatient) was run through the checkout mission using only the stock Playwright MCP (`@playwright/mcp` 0.0.85, `--viewport-size 390,844 --isolated`) and a persona prompt. The app under test was the local Matchday Tickets app with 15 planted flaws. Each gap below is a reason for a feature of the PersonaQA browser server.

## The run

| Measure | Value |
|---------|-------|
| Model | Sonnet 5.5 via `claude -p` |
| Outcome (self-reported) | Success, reached `/order/confirmed` |
| Turns / wall time | 18 / 49s |
| Tokens | 41.7K cache write, 431.6K cache read, 3.3K output |
| Cost | $0.24 |
| Largest single tool result | 45.6K characters (seat map snapshot: 240 seat links) |
| Issues reported | 11 |
| Planted flaws clearly found | 7 of 15 (cookie banner, idiom errors, form clears, hidden fee, US dates, spaced card number, crest alt text) |
| Partly found | 2 (seat map slowness surfaced only as a tool timeout; colour-only sold seats surfaced as "seat no longer available" without the cause) |
| False positives | 2 ("broken images" inferred from alt text; seat map "unsorted" opinion) |

The persona prompt alone produced a believable, useful journal. The problems are all in the harness.

## Gaps and what the server does about each

| # | Gap observed | Evidence | Server answer |
|---|--------------|----------|---------------|
| 1 | Environment not enforced | Only the viewport changed: no touch, no mobile user agent, no 3G throttling, no locale or timezone | `environment.ts`: presets, device descriptors, CDP network throttling, locale, timezone, text zoom |
| 2 | Slowness invisible to the persona | The 6s seat map surfaced as "tool timeout at 5s", not as James waiting | Every action returns its duration; patience accounting against `patience_seconds` and "you waited 9s" notices |
| 3 | Token-heavy snapshots | Seat map snapshot of 45.6K characters, re-sent in history every later turn | `snapshot.ts`: interactive elements and visible text only, collapsing repeated controls, diffs against the previous snapshot |
| 4 | Agent used the address bar | James typed `/checkout?seat=242` directly instead of using the seat map | No free `navigate`: only `start_session` opens `start_url`; movement is `tap`, `type`, `press`, `scroll`, `back` |
| 5 | No domain guard | `browser_navigate` accepts any URL | Requests outside `allowed_domains` are refused at the browser context |
| 6 | JavaScript available to the agent | `browser_evaluate` and `browser_run_code_unsafe` are exposed | Restricted, human-like tool set; no evaluate |
| 7 | Success is the model's claim | The run "succeeded" because the agent said so | `mission.ts` checks `success` rules after every action and ends the session itself |
| 8 | No eyes | Alt text read as "images are not loading" (they loaded) | `look` returns a screenshot when asked, so layout and imagery claims are checked visually |
| 9 | No limits beyond `--max-turns` | Nothing stops a wandering run except the turn cap | `max_steps_per_run`, `max_minutes_per_run`, mission `time_limit_minutes` |
| 10 | No structured output | Journal and issues exist only as free text in the final message; no screenshots or trace kept | `writer.ts`: `journal.md`, `issues.json`, `actions.log`, screenshots, Playwright trace |
| 11 | No disruption | Signal never drops, session never expires | Injected `offline` and `session_expiry` events from the persona file |
| 12 | Repeated Pay presses went unnoticed | Pay was pressed four times across two attempts; slow responses were indistinguishable from failures | Action timings plus per-step screenshots let the coordinator spot double submits |

## What carried over unchanged

- A persona prompt with fixed trait values produces consistent, in-character behaviour and a readable journal.
- Clicking by snapshot reference respects real hit-testing, so overlays such as the cookie banner block taps as they would for a person.
- Prompt caching keeps a long run cheap: most input was cache reads.
