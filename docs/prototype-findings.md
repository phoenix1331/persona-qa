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

## After: the same run on the PersonaQA browser server

James was run again through the same mission from a plain `claude -p` session with only the PersonaQA server attached (no plugin yet, no file tools), using the planted-flaw app and the persona file above.

| Measure | Stock Playwright MCP | PersonaQA server |
|---------|----------------------|------------------|
| Environment | 390x844 viewport only | iPhone 15, touch, slow 3G (2s latency), en-GB, Europe/London |
| Outcome | "Success", claimed by the agent | Abandoned (`incomplete`), decided by the server |
| Turns / wall time | 18 / 49s | 18 / 86s |
| Cost | $0.24 | $0.14 |
| Tokens | 41.7K cache write, 431.6K cache read | 21.2K cache write, 293.4K cache read |
| Seat map snapshot | 45.6K characters | about 2K characters per screen |
| Address bar shortcut | Used (`/checkout?seat=242`) | Not possible |
| Slowness | Seen only as a tool timeout | Three "you waited 8.5s, longer than your 8s" notices |
| Evidence | Final message only | `journal.md`, `run.json`, `actions.log`, 13 screenshots, `trace.zip` |

### What happened

James never reached checkout. On a phone over slow 3G, every seat map load took about 8.5s, past his 8s patience. Each of his three seat choices bounced back to the fixtures list with "Sorry, that seat is no longer available". The Playwright trace shows the three requests went to seats that were genuinely sold: sold seats in this app differ only by a slightly duller green (planted flaw F15), their accessible names are identical to free seats, and they still link to checkout. Without asking for a screenshot, a text-only persona has no way to tell them apart. With throttling and patience enforced, that flaw plus the slow seat map (F03) was enough to lose the sale.

### Lessons for the runner agent

- **Prompt for screenshots on visual choices.** James never asked for one. The `persona-runner` instructions should tell personas to look at a screenshot when choosing from a visual layout (seat maps, colour-coded states), because that is what a sighted person would use.
- **Trust the trace over the journal.** James's journal says he tried "North C4"; the trace shows C3. Journals are the persona's memory, not a record. Reports should cite `actions.log` and the trace for facts and the journal for experience.
- **Patience notices work.** The persona reacted to them in character ("wasn't wasting any more data") without the server forcing an exit.
- **Cost went down even though the run was harder**, because the snapshots are smaller and diffs replace repeated full pages.
