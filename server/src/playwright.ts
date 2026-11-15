import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as PlaywrightModule from 'playwright';
import { PersonaQAError } from './errors.js';

type Playwright = typeof PlaywrightModule;

let cached: Playwright | undefined;

/** The plugin's persistent data folder. Claude Code sets CLAUDE_PLUGIN_DATA for plugin MCP servers. */
export function pluginDataDir(): string | undefined {
  const value = process.env['PERSONAQA_DATA'] ?? process.env['CLAUDE_PLUGIN_DATA'];
  return value === undefined || value === '' ? undefined : value;
}

/** Points Playwright at the browser the setup hook downloaded, unless something else already chose one. */
export function useInstalledBrowser(): void {
  const dataDir = pluginDataDir();
  if (process.env['PLAYWRIGHT_BROWSERS_PATH'] === undefined && dataDir !== undefined) {
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = join(dataDir, 'browsers');
  }
}

function origins(): string[] {
  const dataDir = pluginDataDir();
  const list = [import.meta.url];
  if (dataDir !== undefined && dataDir !== '') {
    list.push(pathToFileURL(join(dataDir, 'node_modules', 'personaqa.js')).href);
  }
  return list;
}

/**
 * Resolves a runtime dependency beside the plugin first, then in the plugin data folder where the setup hook
 * installs it. Dependencies are never bundled, so the server can start and explain what is missing.
 */
export function runtimeResolve(specifier: string): string {
  for (const origin of origins()) {
    try {
      return createRequire(origin).resolve(specifier);
    } catch {
      // try the next location
    }
  }

  const name = specifier.split('/')[0] ?? specifier;
  throw new PersonaQAError(setupMessage(pluginDataDir(), `${name} is not installed yet.`));
}

/** Loads Playwright through `runtimeResolve`. */
export function playwright(): Playwright {
  cached ??= createRequire(import.meta.url)(runtimeResolve('playwright')) as Playwright;
  return cached;
}

export function setupMessage(dataDir: string | undefined, fallback: string): string {
  const statusFile = dataDir === undefined ? undefined : join(dataDir, 'setup-status.json');
  if (statusFile === undefined || !existsSync(statusFile)) {
    return `${fallback} Start a new Claude Code session so the PersonaQA setup hook can install it.`;
  }

  try {
    const status = JSON.parse(readFileSync(statusFile, 'utf8')) as {
      state?: string;
      message?: string;
    };
    if (status.state === 'installing') {
      return 'PersonaQA is still installing the browser (first run only). Try again in a minute.';
    }
    return `${fallback} Last setup attempt: ${status.message ?? status.state ?? 'unknown'}. See ${join(dataDir ?? '', 'setup.log')}.`;
  } catch {
    return `${fallback} Start a new Claude Code session to retry setup.`;
  }
}
