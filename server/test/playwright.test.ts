import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playwright, setupMessage } from '../src/playwright.js';

describe('playwright loader', () => {
  it('loads Playwright from the server dependencies in development', () => {
    expect(typeof playwright().chromium.launch).toBe('function');
    expect(playwright()).toBe(playwright());
  });
});

describe('setupMessage', () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), 'personaqa-data-'));

  it('asks for a new session when setup never ran', () => {
    expect(setupMessage(undefined, 'Chromium is not installed yet.')).toContain(
      'Start a new Claude Code session',
    );
    expect(setupMessage(dir(), 'Chromium is not installed yet.')).toContain(
      'Start a new Claude Code session',
    );
  });

  it('says to wait while the install is running', () => {
    const data = dir();
    writeFileSync(join(data, 'setup-status.json'), JSON.stringify({ state: 'installing' }));

    expect(setupMessage(data, 'x')).toBe(
      'PersonaQA is still installing the browser (first run only). Try again in a minute.',
    );
  });

  it('points at the log when setup failed', () => {
    const data = dir();
    writeFileSync(
      join(data, 'setup-status.json'),
      JSON.stringify({ state: 'failed', message: 'Chromium download failed' }),
    );

    const message = setupMessage(data, 'Chromium is not installed yet.');
    expect(message).toContain('Last setup attempt: Chromium download failed');
    expect(message).toContain(join(data, 'setup.log'));
  });

  it('copes with an unreadable status file', () => {
    const data = dir();
    writeFileSync(join(data, 'setup-status.json'), '{oops');

    expect(setupMessage(data, 'x')).toContain('retry setup');
  });
});
