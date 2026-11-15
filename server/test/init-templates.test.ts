import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validate } from '../src/validation.js';

const templates = join(import.meta.dirname, '../../templates/init');

function fill(file: string, values: Record<string, string>): unknown {
  let text = readFileSync(join(templates, file), 'utf8');
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{{${key}}}`, value);
  expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/);
  return parse(text);
}

describe('init templates', () => {
  it('produce a valid config once filled', () => {
    const config = fill('config.yaml', {
      APP_NAME: 'Shop',
      BASE_URL: 'https://staging.shop.test',
      HOST: 'staging.shop.test',
      PERSONAS: 'james, priya',
      FIRST_PERSONA: 'james',
    });

    expect(validate('config', config).issues).toEqual([]);
  });

  it('produce a valid starter mission once filled', () => {
    expect(
      validate('mission', fill('missions/first-visit.yaml', { SUCCESS_PATH: '/signup/complete' }))
        .issues,
    ).toEqual([]);
  });
});
