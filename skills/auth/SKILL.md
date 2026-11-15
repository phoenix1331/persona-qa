---
description: Saves a signed-in browser login for PersonaQA so personas can test pages behind a login. Use for "/personaqa:auth", "set up login for personas", or when a run says no saved login exists.
argument-hint: "[account]"
allowed-tools: Read, Edit, Write, Glob, Agent, mcp__plugin_personaqa_browser__validate_project
---

# PersonaQA login setup

Arguments: `$ARGUMENTS` (an account key from `auth.accounts`; default `default`, or the only account if there is one).

Personas can test signed-in pages in two ways, set by `auth.strategy` in `.personaqa/config.yaml`:

| Strategy | What happens | Use when |
|----------|--------------|----------|
| `storage_state` | A saved login is loaded into every persona's browser, so they start signed in | You want to test what happens after sign-in, quickly |
| `login_mission` | Every persona signs in themselves first, then carries on with their mission | The sign-in journey itself is worth testing |

This skill creates the saved login for `storage_state`.

## 1. Check the account

Read `.personaqa/config.yaml`. The account must exist under `auth.accounts` with `email` and `password`. If it does not, show the user this block to add, and stop:

```yaml
auth:
  strategy: storage_state
  accounts:
    default:
      email: ${PERSONAQA_USER_EMAIL}
      password: ${PERSONAQA_USER_PASSWORD}
```

Values like `${PERSONAQA_USER_EMAIL}` are read from environment variables, so passwords stay out of the repository. Use a test account on a staging site, never a real customer's.

## 2. Check the sign-in mission

Use `auth.login_mission` if set, otherwise `.personaqa/missions/login.yaml`. If neither exists, ask the user for the sign-in page path and a path that only appears once signed in, then copy `${CLAUDE_PLUGIN_ROOT}/templates/init/missions/login.yaml` to `.personaqa/missions/login.yaml`, filling `{{LOGIN_PATH}}` and `{{SIGNED_IN_PATH}}`, and setting `account` to the account key.

## 3. Sign in and save

Start one `personaqa:persona-runner` subagent with this prompt:

```
Persona: signin
Mission: <login mission id>
run_id: auth-<account>
save_login: true
Call start_session with these values, sign in with the account details in the brief, then finish.
```

When it returns, check that the saved login exists: `auth.accounts.<account>.storage_state`, else `auth.storage_state`, else `.personaqa/auth/<account>.json`.

If it does not exist, the sign-in did not succeed: show the runner's reply. Sites with CAPTCHA, single sign-on or two-factor codes cannot be signed into automatically; tell the user to create the file by hand instead, signing in in the browser window this opens:

```bash
npx playwright codegen --save-storage=.personaqa/auth/<account>.json <base_url>
```

## 4. Use it

First make sure the repository's `.gitignore` contains `.personaqa/auth/` (and `.personaqa/runs/`); add the lines if they are missing, without asking, because the file holds a live login. Then, if `auth.strategy` is not already `storage_state`, set it, and set `storage_state: .personaqa/auth/<account>.json` (or the account's own `storage_state` when there are several accounts). Call `validate_project`.

Remind the user that `.personaqa/auth/` must stay gitignored (it holds a live login), that logins expire (run `/personaqa:auth` again when runs land on the sign-in page), and that CI needs the same file, created in the job or restored from a secret.
