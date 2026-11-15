---
title: Configuration reference
nav_order: 8
---

# Configuration reference

Everything lives in `.personaqa/config.yaml`. Only `version` and `app` are required; every other section has defaults. `/personaqa:init` writes a commented starting point, and `/personaqa:validate` checks the file against the [schema](https://github.com/phoenix1331/persona-qa/blob/main/schema/config.schema.json).

Any string value can use `${ENV_VAR}` or `${ENV_VAR:-default}`.

## app

| Key | Default | Notes |
|-----|---------|-------|
| `name` | required | Shown in reports |
| `base_url` | required | Where mission `start_url` paths are resolved. `--base-url` on a run overrides it |
| `allowed_domains` | required | Hosts the browser may load, as `host`, `host:port` or `*.example.com`. Everything else is refused, including links, images and scripts. Add payment or sign-in providers your journeys use |

## auth

See [Logins](authentication.md).

| Key | Default | Notes |
|-----|---------|-------|
| `strategy` | `none` | `none`, `storage_state` or `login_mission` |
| `storage_state` | none | Saved login file, for example `.personaqa/auth/default.json` |
| `login_mission` | none | Mission id that signs in |
| `accounts.<key>` | none | `email`, `password` and optional `storage_state` |

## runner

| Key | Default | Notes |
|-----|---------|-------|
| `max_parallel` | 3 | Personas running at once (1 to 10) |
| `max_steps_per_run` | 60 | Actions before a session ends as `limit`. A mission's `max_steps` overrides it |
| `max_minutes_per_run` | 8 | Minutes before a session ends as `limit`. A mission's `time_limit_minutes` overrides it |
| `model` | `sonnet` | Model for persona runners, for example `haiku` to cut cost |

## personas and missions

| Key | Default | Notes |
|-----|---------|-------|
| `personas.enabled` | `all` | `all` or a list of ids run when no personas are named |
| `personas.paths` | `[.personaqa/personas]` | Folders searched before the built-in cast |
| `missions.paths` | `[.personaqa/missions]` | Folders holding missions |

## output

| Key | Default | Notes |
|-----|---------|-------|
| `dir` | `.personaqa/runs` | Where run folders go (gitignored by `/personaqa:init`) |
| `screenshots` | `on_issue` | `every_action`, `on_issue` (issues, accessibility problems and the final screen) or `off` |
| `trace` | `on_failure` | Playwright trace: `always`, `on_failure` (sessions that did not succeed) or `off` |
| `regression_tests` | `suggest` | Reserved; not used yet. Write tests on request with `/personaqa:test` |

## issues

| Key | Default | Notes |
|-----|---------|-------|
| `sink` | `file` | `github` makes `/personaqa:report file` (and the nightly workflow) file every finding at or above `min_severity`, not only confirmed ones |
| `github.labels` | `[personaqa]` | Added to every issue, alongside `a11y` or `ux` and `wcag-x.y.z` labels |
| `github.min_severity` | `medium` | `low`, `medium`, `high` or `critical` |

## ci

Named sets for `/personaqa:run --set <name>`:

```yaml
ci:
  pull_request:
    personas: [james, priya]
    missions: [checkout]
  nightly:
    personas: all
    missions: all
```

## inspectors

| Key | Default | Notes |
|-----|---------|-------|
| `a11y.enabled` | `true` | Accessibility inspector, and axe-core scans during runs |
| `a11y.standard` | `wcag22` | `wcag21` or `wcag22` |
| `a11y.level` | `AA` | `A`, `AA` or `AAA` |
| `a11y.mode` | `ride_along` | `ride_along` scans every new page a persona reaches; `sweep` only scans in `/personaqa:audit`; `both` |
| `a11y.ignore` | `[]` | axe rule ids to skip, for example `color-contrast-enhanced` |
| `ux.enabled` | `true` | UX inspector |
| `ux.heuristics` | `nielsen` | Nielsen's ten usability heuristics |

Turn inspectors off for one run with `--no-inspectors`, or run only one with `--with a11y`.
