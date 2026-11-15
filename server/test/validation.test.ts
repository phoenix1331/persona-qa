import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validate } from '../src/validation.js';

const examples = join(import.meta.dirname, '../../examples/.personaqa');

function loadYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'));
}

const fullPersona = {
  id: 'james',
  name: 'James',
  age: 23,
  bio: 'Bus commuter on a phone.',
  environment: { preset: 'mobile-3g', locale: 'en-GB', timezone: 'Europe/London' },
  traits: { patience_seconds: 8, reading: 'skims', tech_confidence: 'high' },
};

describe('example config', () => {
  it('validates config.yaml', () => {
    expect(validate('config', loadYaml(join(examples, 'config.yaml')))).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each(readdirSync(join(examples, 'missions')))('validates mission %s', (file) => {
    expect(validate('mission', loadYaml(join(examples, 'missions', file))).issues).toEqual([]);
  });

  it.each(readdirSync(join(examples, 'personas')))('validates persona %s', (file) => {
    expect(validate('persona', loadYaml(join(examples, 'personas', file))).issues).toEqual([]);
  });
});

describe('config schema', () => {
  const minimal = {
    version: 1,
    app: {
      name: 'Shop',
      base_url: 'https://staging.shop.test',
      allowed_domains: ['staging.shop.test'],
    },
  };

  it('accepts a minimal config', () => {
    expect(validate('config', minimal).valid).toBe(true);
  });

  it('reports unknown fields by name', () => {
    const result = validate('config', { ...minimal, colour: 'red' });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ path: '/', message: 'unknown field "colour"' });
  });

  it('requires a storage state path for the storage_state strategy', () => {
    const result = validate('config', { ...minimal, auth: { strategy: 'storage_state' } });

    expect(result.issues).toContainEqual({
      path: '/auth',
      message: 'missing required field "storage_state"',
    });
  });

  it('rejects domains with schemes', () => {
    const result = validate('config', {
      ...minimal,
      app: { ...minimal.app, allowed_domains: ['https://staging.shop.test'] },
    });

    expect(result.issues[0]?.path).toBe('/app/allowed_domains/0');
  });

  it('accepts "all" or a list of ids for selections', () => {
    expect(validate('config', { ...minimal, personas: { enabled: 'all' } }).valid).toBe(true);
    expect(validate('config', { ...minimal, personas: { enabled: ['james'] } }).valid).toBe(true);
    expect(validate('config', { ...minimal, personas: { enabled: 'everyone' } }).valid).toBe(false);
  });

  it('lists allowed values for enums', () => {
    const result = validate('config', { ...minimal, output: { trace: 'sometimes' } });

    expect(result.issues).toContainEqual({
      path: '/output/trace',
      message: 'must be one of: always, on_failure, off',
    });
  });
});

describe('persona schema', () => {
  it('accepts a full persona', () => {
    expect(validate('persona', fullPersona).issues).toEqual([]);
  });

  it('requires the core fields when not extending', () => {
    const result = validate('persona', { id: 'nobody' });

    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'missing required field "name"',
        'missing required field "bio"',
        'missing required field "environment"',
        'missing required field "traits"',
      ]),
    );
  });

  it('allows a partial persona that extends another', () => {
    expect(
      validate('persona', { id: 'james-slow', extends: 'james', traits: { patience_seconds: 4 } })
        .valid,
    ).toBe(true);
  });

  it('rejects unknown presets and malformed ranges', () => {
    const result = validate('persona', {
      ...fullPersona,
      environment: {
        preset: 'mobile-5g',
        events: { offline: { chance: 0.3, duration_seconds: [10] } },
      },
    });

    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        '/environment/preset',
        '/environment/events/offline/duration_seconds',
      ]),
    );
  });

  it('rejects ids with capitals or spaces', () => {
    expect(validate('persona', { ...fullPersona, id: 'James Smith' }).valid).toBe(false);
  });
});

describe('mission schema', () => {
  const mission = {
    id: 'checkout',
    goal: 'Buy a ticket.',
    start_url: '/fixtures',
    success: { any: [{ url_contains: '/done' }] },
  };

  it('accepts each success rule type', () => {
    for (const rule of [
      { url_contains: '/x' },
      { url_matches: '^/x' },
      { text_visible: 'Done' },
      { element_visible: '#ok' },
    ]) {
      expect(validate('mission', { ...mission, success: { all: [rule] } }).valid).toBe(true);
    }
  });

  it('rejects unknown success rules and empty rule lists', () => {
    expect(
      validate('mission', { ...mission, success: { any: [{ title_is: 'Done' }] } }).valid,
    ).toBe(false);
    expect(validate('mission', { ...mission, success: { any: [] } }).valid).toBe(false);
  });

  it('rejects both any and all together', () => {
    expect(
      validate('mission', {
        ...mission,
        success: { any: [{ url_contains: '/a' }], all: [{ url_contains: '/b' }] },
      }).valid,
    ).toBe(false);
  });

  it('requires start_url to be a path or http URL', () => {
    expect(validate('mission', { ...mission, start_url: 'fixtures' }).valid).toBe(false);
  });
});
