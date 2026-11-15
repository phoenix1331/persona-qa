---
title: Logins
nav_order: 5
---

# Testing pages behind a login

Personas can start signed in, or sign in themselves as part of every run. Use test accounts on a staging site, never real customer accounts.

## 1. Add the account

In `.personaqa/config.yaml`:

```yaml
auth:
  strategy: storage_state       # or login_mission, see below
  accounts:
    default:
      email: ${PERSONAQA_USER_EMAIL}
      password: ${PERSONAQA_USER_PASSWORD}
```

`${NAME}` is read from an environment variable when the config loads, so passwords stay out of the repository; `${NAME:-fallback}` supplies a default. Export the variables in your shell, or set them as CI secrets.

You can define several accounts (`default`, `admin`, `new-customer`) and choose one per mission with `account: admin`. Missions without `account` use `default` when auth is switched on.

## 2. Add a sign-in mission

`.personaqa/missions/login.yaml`:

```yaml
id: login
goal: Sign in with your account details.
start_url: /login
account: default
success:
  any:
    - url_contains: /account
```

Pick a success rule that only passes once signed in. Personas see the account's email and password in their brief.

## 3. Choose a strategy

| Strategy | What happens | Use when |
|----------|--------------|----------|
| `storage_state` | A saved login is loaded into every persona's browser, so they start signed in | You are testing what happens after sign-in, and want runs to be quick |
| `login_mission` | Each persona signs in first using the sign-in mission. Once its success rule passes, the browser moves them to their real mission | The sign-in journey itself is worth testing, or saved logins expire too quickly |

### Saved login (`storage_state`)

Create the saved login once:

```
/personaqa:auth default
```

A neutral helper signs in with the account, the browser saves the cookies and storage to `.personaqa/auth/default.json`, and the config is switched to `storage_state`. It also makes sure `.personaqa/auth/` is gitignored: the file holds a live login and must never be committed.

Sites with CAPTCHA, single sign-on or two-factor codes cannot be signed into automatically. Sign in yourself in the browser window this opens, then close it:

```bash
npx playwright codegen --save-storage=.personaqa/auth/default.json https://staging.your-app.test
```

For several accounts, give each its own file:

```yaml
auth:
  strategy: storage_state
  accounts:
    default: { email: "${USER_EMAIL}", password: "${USER_PASSWORD}", storage_state: .personaqa/auth/default.json }
    admin: { email: "${ADMIN_EMAIL}", password: "${ADMIN_PASSWORD}", storage_state: .personaqa/auth/admin.json }
```

Saved logins expire. When personas start landing on the sign-in page, run `/personaqa:auth` again.

### Sign-in first (`login_mission`)

```yaml
auth:
  strategy: login_mission
  login_mission: login
  accounts:
    default:
      email: ${PERSONAQA_USER_EMAIL}
      password: ${PERSONAQA_USER_PASSWORD}
```

Every persona's brief starts with "First you need to sign in". Sign-in steps count towards the step and time limits, and problems with the sign-in page show up in the report like any other.

## In CI

For `login_mission`, set the account variables as secrets. For `storage_state`, either run `/personaqa:auth` at the start of the job (it needs the same secrets) or store the saved login file as an encrypted secret and write it to `.personaqa/auth/` before the run.

## Checking

```
/personaqa:validate
```

reports a `login_mission` that does not exist. A missing saved login is reported when a run starts, with the command to create it.
