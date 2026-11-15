# Running PersonaQA in GitHub Actions

Two example workflows live in [`examples/github/`](../examples/github/). Copy them into your app's `.github/workflows/`.

| Workflow | When | What it runs | Output |
|----------|------|--------------|--------|
| [`personaqa-pull-request.yml`](../examples/github/personaqa-pull-request.yml) | Every pull request | The `pull_request` set from `.personaqa/config.yaml` (keep it small: two personas, one or two key missions) against the PR's preview deploy | `summary.md` as a sticky PR comment, run folder as an artifact |
| [`personaqa-nightly.yml`](../examples/github/personaqa-nightly.yml) | Nightly and on demand | The `nightly` set (usually the full cast) against staging | GitHub issues for findings at or above `issues.github.min_severity`, run folder as an artifact |

Persona runs are exploration, not a pass/fail gate: the workflows never fail the build because of findings.

## Setup

1. Run `/personaqa:init` in your app's repository and commit `.personaqa/` (without `runs/` and `auth/`, which it gitignores).
2. Add run sets to `.personaqa/config.yaml`:

   ```yaml
   ci:
     pull_request:
       personas: [james, priya]
       missions: [checkout]
     nightly:
       personas: all
       missions: all
   ```

3. Add an `ANTHROPIC_API_KEY` repository secret. A `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) also works with the `claude_code_oauth_token` input, but it is tied to one person's plan, so teams should use an API key.
4. In the pull request workflow, set `PREVIEW_URL` to however your pipeline exposes the preview deploy. Add that host to `app.allowed_domains` (a `--base-url` host is allowed automatically for that run).
5. For nightly issue filing, set `issues.sink: github` and `issues.github.min_severity` in the config.

## How it works

- `anthropics/claude-code-action@v1` adds the marketplace (`plugin_marketplaces`) and installs `personaqa@persona-qa` (`plugins`), then runs the slash command given as `prompt`.
- The plugin's SessionStart hook normally downloads Chromium in the background on first use. A one-shot CI job cannot wait for that, so the workflow installs it first (with system libraries) into the plugin's data folder, `~/.claude/plugins/data/personaqa-persona-qa/browsers`, where the browser server looks.
- `--allowedTools` covers what the run needs: subagents (`Agent`), reading and writing run files, `node` for the report scripts, the PersonaQA browser tools, and for nightly filing `gh issue` and `gh label`.
- Nightly filing skips dismissed findings (from the committed `.personaqa/triage.json`) and any finding that already has an open issue with the same title.

## Without the action

Any CI system that can run Claude Code can do the same. Project-level marketplace settings are not trusted automatically in headless mode, so add the marketplace explicitly:

```bash
npm install -g @anthropic-ai/claude-code
claude plugin marketplace add phoenix1331/persona-qa
claude plugin install personaqa@persona-qa
PLAYWRIGHT_BROWSERS_PATH="$HOME/.claude/plugins/data/personaqa-persona-qa/browsers" \
  npx --yes playwright@1.65.1 install --with-deps --only-shell chromium
claude -p "/personaqa:run --set pull_request --base-url $PREVIEW_URL" \
  --allowedTools "Agent,Read,Glob,Write,Bash(node *),mcp__plugin_personaqa_browser__*" \
  --max-turns 150
```

The run folder is `.personaqa/runs/<run id>/`; post its `summary.md` wherever your team reads results.

## Cost

Each persona x mission pair is one run. A small PR set is typically two runs; a nightly cast of five personas and four missions is twenty. Every `summary.md` reports the tokens Claude Code recorded for the persona runners; the billed cost of a run is `total_cost_usd` in `claude -p --output-format json`. On the demo app a five-persona checkout run with both inspectors cost about $1.50 with Sonnet. See the README for the cost levers.
