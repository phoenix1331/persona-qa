---
title: Missions
nav_order: 3
---

# Missions

A mission is one journey a real person takes on your site, written as a plain-English goal plus a rule that proves the goal was reached. Personas get the goal; only the browser sees the rule.

Missions live in `.personaqa/missions/<id>.yaml`, one per file, named after their `id`.

## A complete example

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/phoenix1331/persona-qa/main/schema/mission.schema.json
id: checkout
goal: Buy one adult ticket for Saturday's match and get to the confirmation page.
start_url: /fixtures
time_limit_minutes: 4
max_steps: 40
account: default
success:
  any:
    - url_contains: /order/confirmed
    - text_visible: Order confirmed
data:
  card: "4242 4242 4242 4242"
  expiry: "12/30"
  cvc: "123"
context: >
  The persona knows which match they want but not the stadium layout.
```

The first line gives editors that understand YAML schemas (VS Code with the YAML extension, JetBrains IDEs) autocomplete and inline errors.

## Fields

| Field | Required | What it does |
|-------|----------|--------------|
| `id` | yes | Lowercase letters, digits and hyphens. Used in commands (`/personaqa:run james checkout`) and must match the file name |
| `goal` | yes | What the persona is trying to do, in their terms. One or two sentences |
| `start_url` | yes | Where the browser opens: a path (`/fixtures`, resolved against `app.base_url`) or a full URL on an allowed domain |
| `success` | yes | The rule the browser checks after every action. See below |
| `time_limit_minutes` | no | Ends the session as `limit` after this long. Defaults to `runner.max_minutes_per_run` (8) |
| `max_steps` | no | Ends the session after this many actions. Defaults to `runner.max_steps_per_run` (60) |
| `account` | no | Which account from `auth.accounts` this mission uses. See [Logins](authentication.md) |
| `data` | no | Values the persona has to hand, such as test card details or a discount code. Shown in their brief |
| `context` | no | Anything else the person would know before starting |

## Success rules

The browser checks the rules after every action and ends the session as `success` the moment they pass. The persona cannot declare success, and the model is never asked whether it succeeded.

| Rule | Passes when | Example |
|------|-------------|---------|
| `url_contains` | The current URL contains the text | `url_contains: /order/confirmed` |
| `url_matches` | The current URL matches a JavaScript regular expression | `url_matches: "/orders/\\d+/thanks"` |
| `text_visible` | Text is visible on screen (not hidden, not just in the HTML) | `text_visible: Order confirmed` |
| `element_visible` | A CSS selector matches a visible element | `element_visible: "[data-test=receipt]"` |

Combine them with `any` (one rule is enough) or `all` (every rule must pass), not both:

```yaml
success:
  all:
    - url_contains: /account
    - text_visible: Your tickets
```

## Writing good missions

**Write the goal as the person would say it.** "Buy one adult ticket for Saturday's match" gives a persona something to reason about. "Click Choose seats, then pick a seat" turns them into a script and hides exactly the confusion you want to find.

**Make success unmistakable.** Pick something that only appears when the job is really done: a confirmation URL, a receipt heading, an order number element.

| Weak rule | Why | Better |
|-----------|-----|--------|
| `url_contains: /` | Passes on every page | `url_contains: /order/confirmed` |
| `text_visible: Thank you` | Also appears in a footer or a newsletter popup | `text_visible: Order confirmed` |
| `url_contains: /checkout` | Passes when they reach checkout, not when they finish | `url_contains: /checkout/complete` |

**Start where real people start.** Usually a landing or listing page, not deep inside the flow. Personas only find problems on the pages their mission takes them through: in the demo, two planted flaws were missed simply because no mission went near them.

**Cover the journeys that matter.** Sign-up, checkout, search, account changes, cancelling. One mission per journey keeps reports readable.

**Give them the data a person would have.** Test card numbers, a promo code, an order reference. Never real card numbers or real people's details.

**Keep limits realistic.** A checkout that takes a person three minutes might need 40 steps for a persona. If personas often hit the limit, the journey may genuinely be too long; check the journal before raising it.

## Checking and running

```
/personaqa:validate
/personaqa:run james checkout
/personaqa:run all checkout,signup
```
