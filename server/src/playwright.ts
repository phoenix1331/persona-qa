import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as PlaywrightModule from 'playwright';
import { PersonaQAError } from './errors.js';

type Playwright = typeof PlaywrightModule;

let cached: Playwright | undefined;

/**
 * Loads Playwright at runtime instead of importing it, so the server can start (and explain what is missing)
 * whether Playwright sits next to the plugin or was installed into the plugin data folder by the setup hook.
 */
export function playwright(): Playwright {
  if (cached !== undefined) {
    return cached;
  }

  const dataDir = process.env['PERSONAQA_DATA'];
  const origins = [import.meta.url];
  if (dataDir !== undefined && dataDir !== '') {
    origins.push(pathToFileURL(join(dataDir, 'node_modules', 'personaqa.js')).href);
  }

  for (const origin of origins) {
    try {
      cached = createRequire(origin)('playwright') as Playwright;
      return cached;
    } catch {
      // try the next location
    }
  }

  throw new PersonaQAError(setupMessage(dataDir, 'Playwright is not installed yet.'));
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
