# Short: "I gave my app to five AI users"

Vertical video, about 50 seconds. Footage: `walkthrough.gif` frames, screenshots from a run folder, `report.html`, and a terminal running `/personaqa:run`.

| Time | On screen | Voice-over |
|------|-----------|------------|
| 0-3s | Five persona cards flip in: James, Margaret, Priya, Tomasz, Chaos | "I gave my app to five AI users." |
| 3-8s | Terminal: `/personaqa:run james,margaret,priya,tomasz,chaos checkout`, runs starting in parallel | "Each one is a real person: a device, a connection, how patient they are." |
| 8-15s | James's phone view, "You waited 8.5s, longer than you would normally put up with" | "James is on a bus with slow 3G. The browser actually throttles him." |
| 15-22s | Chaos's frames: rejected seat, truncated card number, wiped form | "Chaos tries to break everything, and the shop keeps breaking first." |
| 22-28s | Chaos's confirmation: £25.00 paid for a £22.50 seat | "And four of them caught a fee the checkout never showed." |
| 28-34s | Priya's run: "focused, but nothing on screen shows it" | "Priya only uses a keyboard. The site had hidden where focus was." |
| 34-42s | `report.html`: ranked findings, Accessibility and UX tabs | "Afterwards, specialist agents review everything and rank what to fix first." |
| 42-48s | Score card: "13 of 15 planted flaws found" | "I'd hidden fifteen flaws. They found thirteen, for about a dollar fifty in API costs." |
| 48-50s | Logo and repo link | "PersonaQA. Link in bio." |

Notes: the dollar figure is the API-rate cost Claude Code reports (`total_cost_usd`) with Sonnet; on a Pro or Max plan there is no per-run charge, so say "in API costs" and do not imply a bill. The persona agents never see the code or the answer key; the success check is done by the browser, not the agent. Say "simulated users" in the caption so nobody mistakes them for real customers.
