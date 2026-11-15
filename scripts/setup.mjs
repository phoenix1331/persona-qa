#!/usr/bin/env node
// SessionStart hook: makes sure Playwright and Chromium are available for the PersonaQA browser server.
// Fast and silent when everything is ready. Slow installs run detached in the background so the session is not held up.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.CLAUDE_PLUGIN_ROOT ?? new URL('..', import.meta.url).pathname;
const data = process.env.CLAUDE_PLUGIN_DATA;
const worker = process.argv.includes('--worker');

if (!data) {
  process.exit(0);
}

mkdirSync(data, { recursive: true });
const browsers = join(data, 'browsers');
// Playwright reads this when it is first loaded, so set it before anything requires it.
process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
const statusFile = join(data, 'setup-status.json');
const lockFile = join(data, 'setup.lock');
const logFile = join(data, 'setup.log');
const LOCK_STALE_MS = 15 * 60 * 1000;

function writeStatus(state, message) {
  writeFileSync(statusFile, `${JSON.stringify({ state, message, at: new Date().toISOString() }, null, 2)}\n`);
}

function loadPlaywright() {
  const origins = [pathToFileURL(join(root, 'package.json')).href, pathToFileURL(join(data, 'package.json')).href];
  for (const origin of origins) {
    try {
      const require = createRequire(origin);
      // cli.js is not in the package exports, so locate it from package.json
      return {
        playwright: require('playwright'),
        cli: join(dirname(require.resolve('playwright/package.json')), 'cli.js'),
      };
    } catch {
      // not here
    }
  }
  return null;
}

function chromiumReady(playwright) {
  try {
    return existsSync(playwright.chromium.executablePath());
  } catch {
    return false;
  }
}

function pinnedVersion() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return manifest.dependencies?.playwright ?? 'latest';
}

function run(command, args, env) {
  const log = openSync(logFile, 'a');
  const result = spawnSync(command, args, { cwd: data, env: { ...process.env, ...env }, stdio: ['ignore', log, log] });
  closeSync(log);
  return result.status === 0;
}

function install() {
  writeStatus('installing', 'Installing Playwright and Chromium');
  let found = loadPlaywright();

  if (found === null) {
    writeFileSync(
      join(data, 'package.json'),
      `${JSON.stringify({ private: true, dependencies: { playwright: pinnedVersion() } }, null, 2)}\n`,
    );
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    if (!run(npm, ['install', '--no-audit', '--no-fund', '--omit=dev'], {})) {
      writeStatus('failed', 'npm install of Playwright failed');
      return;
    }
    found = loadPlaywright();
  }

  if (found === null) {
    writeStatus('failed', 'Playwright could not be loaded after install');
    return;
  }

  if (!chromiumReady(found.playwright) && !run(process.execPath, [found.cli, 'install', '--only-shell', 'chromium'], { PLAYWRIGHT_BROWSERS_PATH: browsers })) {
    writeStatus('failed', 'Chromium download failed (on Linux you may also need: npx playwright install-deps chromium)');
    return;
  }

  writeStatus('ready', 'Playwright and Chromium are installed');
}

if (worker) {
  try {
    install();
  } finally {
    rmSync(lockFile, { force: true });
  }
  process.exit(0);
}

const found = loadPlaywright();
if (found !== null && chromiumReady(found.playwright)) {
  if (!existsSync(statusFile) || JSON.parse(readFileSync(statusFile, 'utf8')).state !== 'ready') {
    writeStatus('ready', 'Playwright and Chromium are installed');
  }
  process.exit(0);
}

const locked = existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs < LOCK_STALE_MS;
if (!locked) {
  writeFileSync(lockFile, String(process.pid));
  writeStatus('installing', 'Installing Playwright and Chromium');
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--worker'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data },
  });
  child.unref();
}

console.log(
  'PersonaQA: installing its browser in the background (first run only, about a minute). /personaqa:run will work once it finishes.',
);
