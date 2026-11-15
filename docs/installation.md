# Installing PersonaQA

## Install

Inside Claude Code:

```
/plugin marketplace add phoenix1331/persona-qa
/plugin install personaqa@persona-qa
```

Or from a shell:

```bash
claude plugin marketplace add phoenix1331/persona-qa
claude plugin install personaqa@persona-qa
```

The repository is its own marketplace (`.claude-plugin/marketplace.json`), so there is nothing else to add.

## What happens on first use

| Step | When | Where |
|------|------|-------|
| Node dependencies (Playwright, axe-core, yaml) | At install, automatically, from the pinned `package-lock.json` | Beside the plugin in Claude Code's plugin cache |
| Chromium headless shell (about 290 MB) | The first session after install, in the background (about a minute) | `~/.claude/plugins/data/personaqa-persona-qa/browsers` |

If a run starts before the download finishes, the browser server says so; try again a minute later. Progress and errors are in `~/.claude/plugins/data/personaqa-persona-qa/setup.log`. If the automatic dependency install was skipped (for example in a restricted network), the same setup hook installs them into the data folder instead.

On Linux, Chromium needs some system libraries. If runs fail to launch the browser, install them once with `npx playwright install-deps chromium` (needs sudo, which the hook cannot do).

Then set up a repository with `/personaqa:init`.

## Share it with your team

Commit this to your app repository's `.claude/settings.json` so everyone who opens the repository is offered the marketplace and plugin:

```json
{
  "extraKnownMarketplaces": {
    "persona-qa": {
      "source": {
        "source": "github",
        "repo": "phoenix1331/persona-qa"
      }
    }
  },
  "enabledPlugins": {
    "personaqa@persona-qa": true
  }
}
```

Each person accepts the workspace trust dialog for the folder, then installs once on their machine:

```bash
claude plugin install personaqa@persona-qa --scope project
```

Claude Code ignores project marketplace settings in folders that have not been trusted, including headless `-p` runs, so CI adds the marketplace explicitly (see [GitHub Actions](github-actions.md)).

## Updates

`plugin.json` pins a `version`, so installs stay on that version until it changes. Releases bump the version; then:

```bash
claude plugin marketplace update persona-qa
claude plugin update personaqa@persona-qa
```

Run `/reload-plugins` (or start a new session) afterwards. Auto-update is off by default for third-party marketplaces; turn it on per marketplace in `/plugin` under Marketplaces.

## Uninstall

```bash
claude plugin uninstall personaqa@persona-qa
```

This also deletes the plugin's data folder, including the downloaded browser. Run folders in your repositories (`.personaqa/runs/`) are left alone.

## Working on PersonaQA itself

Load a local checkout without installing:

```bash
claude --plugin-dir /path/to/persona-qa
```

After editing a skill, agent or hook, run `/reload-plugins`. The browser server is TypeScript in `server/`; rebuild the committed bundle with `npm --prefix server run build`. Plugins loaded this way are not copied, so `npm install` at the repository root provides the runtime dependencies, and the setup hook downloads Chromium into `~/.claude/plugins/data/personaqa-inline/`.
