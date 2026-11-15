import { describe, expect, it } from 'vitest';
import { serverInfo } from '../src/server-info.js';

describe('serverInfo', () => {
  it('identifies the PersonaQA browser server', () => {
    expect(serverInfo.name).toBe('personaqa-browser');
  });

  it('uses a semantic version', () => {
    expect(serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
