---
title: Personas
nav_order: 4
---

# Personas

A persona is a believable person described by how they use software: their device and connection, how patient they are, how they read, and how confident they feel. The browser server **enforces** the environment (device, network, text size, input method, typos, signal drops); the model **plays** the judgement (patience, attention, understanding, when to give up).

{: .important }
Personas are behaviours, not caricatures. Describe how someone uses your app, never assumptions about what people of an age, nationality or background are like.

## The built-in cast

These work in every repository without any files.

| Id | Who | Environment | Plays |
|----|-----|-------------|-------|
| `james` | James, 23, bus commuter | iPhone 15, slow 3G, 30% chance of a signal drop | Skims, 8s patience, typos, uses back often |
| `margaret` | Margaret, 71 | iPad, text at 150% | Reads everything, 30s patience, low trust in payment forms |
| `priya` | Priya, 34, software tester | Desktop, keyboard only | Scrutinises, expects visible focus and no traps |
| `tomasz` | Tomasz, 40 | Pixel 7, 4G, Polish locale and timezone | Reads carefully, English is his second language |
| `chaos` | Chaos | Desktop, 50% chance of a session expiry | Emoji, long input, empty fields, double submits, back mid-flow |

Choose who runs by default with `personas.enabled` in `.personaqa/config.yaml` (`all`, or a list such as `[james, priya]`), or name them on the command line: `/personaqa:run james,margaret checkout`.

## Four ways to get the personas you need

### 1. Adjust a built-in

Create a file with the **same id** that `extends` the built-in and contains only what differs. It replaces the built-in in this repository.

```yaml
# .personaqa/personas/james.yaml
id: james
extends: james
traits:
  patience_seconds: 5
environment:
  network: fast-3g
```

### 2. Make a variant

A new id that `extends` another persona: everything is inherited unless you set it.

```yaml
# .personaqa/personas/james-android.yaml
id: james-android
extends: james
environment:
  preset: mobile-4g
  device: Pixel 7
```

Objects merge field by field; lists (such as `duration_seconds`) are replaced.

### 3. Write one from scratch

```yaml
# .personaqa/personas/night-nurse.yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/phoenix1331/persona-qa/main/schema/persona.schema.json
id: night-nurse
name: Sam
age: 38
bio: >
  Works night shifts and checks the staff rota on a shared Android tablet in
  short gaps between patients. Tired, in a hurry, often interrupted.
environment:
  preset: mobile-4g
  device: Galaxy Tab S9
traits:
  patience_seconds: 8
  reading: skims
  tech_confidence: medium
  typo_rate: medium
  back_button: often
voice: >
  Terse and tired; short fragments.
```

A persona without `extends` needs `name`, `bio`, `environment.preset` and the three core traits (`patience_seconds`, `reading`, `tech_confidence`).

### 4. Generate one

```
/personaqa:persona new "Night shift nurse on an Android tablet, very tired, checks rotas between patients"
```

The persona writer drafts the file, validates it, explains which part of your description each trait came from, and tells you what it left out. Review it before committing.

After any change, run `/personaqa:validate`.

## Field reference

### Who they are

| Field | Notes |
|-------|-------|
| `id` | Lowercase letters, digits and hyphens; matches the file name |
| `extends` | Id of a persona to inherit from (a built-in or one of yours) |
| `name`, `age` | Used in the brief and the report |
| `bio` | Two or three sentences about how they use the app. The model reads this closely |
| `voice` | How they write their journal |

### Environment (enforced by the browser)

| Field | Values | Effect |
|-------|--------|--------|
| `preset` | See the table below | Sets device, input and network in one go |
| `device` | A [Playwright device name](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json) such as `iPhone 15`, `Pixel 7`, `Galaxy S24`, `iPad (gen 7)` | Screen size, user agent, pixel density, touch |
| `viewport` | `{ width, height }` | Overrides the screen size |
| `input` | `touch`, `mouse`, `keyboard_only` | `keyboard_only` removes tapping entirely: the persona must Tab, Enter and Space |
| `network` | `slow-3g`, `fast-3g`, `4g`, `wifi`, `none` | Real throttling through Chrome DevTools (slow 3G adds 2 seconds of latency to every request) |
| `text_zoom` | 1 to 3 | Enlarges text the way the browser text-size setting does: relative sizes grow, fixed pixel sizes do not |
| `reduced_motion` | true or false | Sets `prefers-reduced-motion` |
| `forced_colours` | true or false | High contrast mode (`forced-colors: active`) |
| `locale`, `timezone` | `pl-PL`, `Europe/Warsaw` | Browser language, number and date formats, clock. Defaults `en-GB`, `Europe/London` |
| `events.offline` | `{ chance, duration_seconds: [min, max] }` | Rolled once per run: the signal drops before a step between 2 and 10, then returns. The persona is told, as they would notice it |
| `events.session_expiry` | `{ chance, after_steps: [min, max] }` | Rolled once per run: cookies are cleared, as when a server session times out. The persona is not told |

Presets:

| Preset | Device | Input | Network | Extra |
|--------|--------|-------|---------|-------|
| `mobile-3g` | iPhone 15 | touch | slow 3G | |
| `mobile-4g` | iPhone 15 | touch | 4G | |
| `ipad-large-text` | iPad (gen 7) | touch | fast | text at 150% |
| `desktop-keyboard-only` | 1280x800 | keyboard only | fast | |
| `desktop-reduced-motion` | 1280x800 | mouse | fast | reduced motion, high contrast |
| `desktop-fast` | 1280x800 | mouse | fast | |

Any field you set overrides the preset.

### Traits (played by the model, with two exceptions)

| Trait | Values | How it shows up |
|-------|--------|-----------------|
| `patience_seconds` | 1 to 120 | The browser tells the persona whenever a wait was longer than this ("You waited 9.2s, longer than you would normally put up with"). Whether to give up is the persona's call |
| `reading` | `skims`, `reads`, `scrutinises` | Skimmers act on headings and buttons and miss small print; scrutinisers read everything and notice inconsistencies |
| `tech_confidence` | `low`, `medium`, `high` | Low confidence hesitates, misreads jargon and goes back more |
| `typo_rate` | `none`, `low`, `medium`, `high` | **Enforced:** the browser swaps letters for neighbouring keys at this rate (2%, 5%, 10%) and tells the persona what was really typed |
| `trust_in_payments` | `low`, `medium`, `high` | Low trust reacts strongly to surprise costs and unfamiliar payment steps |
| `back_button` | `never`, `sometimes`, `often` | How readily they press back when unsure |
| `language_confidence` | `low`, `medium`, `high` | How much idioms, jargon and ambiguous formats slow them down |

## Tips

- **Base personas on your real users.** Your analytics already know the device mix, the share of mobile traffic, the slowest connections and the top locales.
- **Two or three personas on pull requests is plenty.** Run the full cast nightly. See [CI with GitHub Actions](github-actions.md).
- **Keep a keyboard-only persona in the set.** It finds problems no other persona can.
- **Check the journal before trusting a trait change.** If a persona gives up where real users do not, their patience is probably too low.
