import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PersonaQAError } from '../src/errors.js';
import { Loader, deepMerge, interpolate } from '../src/loader.js';

const james = `
id: james
name: James
age: 23
bio: Bus commuter.
environment:
  preset: mobile-3g
  locale: en-GB
  events:
    offline: { chance: 0.3, duration_seconds: [10, 30] }
traits:
  patience_seconds: 8
  reading: skims
  tech_confidence: high
voice: Casual.
`;

const config = `
version: 1
app:
  name: Shop
  base_url: \${SHOP_URL:-http://127.0.0.1:8000}
  allowed_domains: [127.0.0.1:8000]
auth:
  strategy: none
  accounts:
    default: { email: "\${SHOP_EMAIL}", password: secret }
`;

const mission = `
id: checkout
goal: Buy a ticket.
start_url: /fixtures
success:
  any:
    - url_contains: /order/confirmed
`;

let root: string;
let project: string;
let builtins: string;

function put(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function loader(env: Record<string, string> = { SHOP_EMAIL: 'fan@example.com' }): Loader {
  return new Loader({ projectDir: project, builtinPersonaDir: builtins, env });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'personaqa-'));
  project = join(root, 'app');
  builtins = join(root, 'plugin', 'personas');
  put(join(builtins, 'james.yaml'), james);
  put(join(project, '.personaqa', 'config.yaml'), config);
  put(join(project, '.personaqa', 'missions', 'checkout.yaml'), mission);
});

describe('config', () => {
  it('interpolates environment variables, uses fallbacks and applies defaults', () => {
    const loaded = loader().config();

    expect(loaded.app.base_url).toBe('http://127.0.0.1:8000');
    expect(loaded.auth.accounts['default']?.email).toBe('fan@example.com');
    expect(loaded.runner.max_parallel).toBe(3);
    expect(loaded.output.screenshots).toBe('on_issue');
    expect(loaded.inspectors.a11y.level).toBe('AA');
  });

  it('fails clearly when a required variable is missing', () => {
    expect(() => loader({}).config()).toThrow(/environment variable SHOP_EMAIL is not set/);
  });

  it('fails clearly when there is no config', () => {
    put(join(project, '.personaqa', 'config.yaml'), '');
    expect(() => loader().config()).toThrow(PersonaQAError);
  });

  it('points at /personaqa:init when .personaqa is missing', () => {
    project = join(root, 'empty');
    expect(() => loader().config()).toThrow(/Run \/personaqa:init/);
  });

  it('lists schema issues with paths', () => {
    put(join(project, '.personaqa', 'config.yaml'), 'version: 1\napp: { name: Shop }\n');

    try {
      loader().config();
      expect.unreachable();
    } catch (error) {
      expect((error as PersonaQAError).describe()).toContain(
        '/app: missing required field "base_url"',
      );
    }
  });
});

describe('personas', () => {
  it('loads a built-in persona', () => {
    const persona = loader().persona('james');

    expect(persona.name).toBe('James');
    expect(persona.sources).toEqual([join(builtins, 'james.yaml')]);
  });

  it('merges extends, keeping parent fields and replacing arrays', () => {
    put(
      join(project, '.personaqa', 'personas', 'james-android.yaml'),
      'id: james-android\nextends: james\nenvironment:\n  preset: mobile-4g\n  device: Pixel 7\n  events:\n    offline: { chance: 0.1, duration_seconds: [5, 5] }\n',
    );

    const persona = loader().persona('james-android');

    expect(persona.id).toBe('james-android');
    expect(persona.name).toBe('James');
    expect(persona.environment).toMatchObject({
      preset: 'mobile-4g',
      device: 'Pixel 7',
      locale: 'en-GB',
      events: { offline: { chance: 0.1, duration_seconds: [5, 5] } },
    });
    expect(persona.traits.patience_seconds).toBe(8);
    expect(persona.sources).toHaveLength(2);
    expect(persona).not.toHaveProperty('extends');
  });

  it('lets a user persona override a built-in with the same id', () => {
    put(
      join(project, '.personaqa', 'personas', 'james.yaml'),
      'id: james\nextends: james\ntraits:\n  patience_seconds: 3\n',
    );

    const persona = loader().persona('james');

    expect(persona.traits.patience_seconds).toBe(3);
    expect(persona.bio).toBe('Bus commuter.');
  });

  it('prefers user personas over built-ins', () => {
    put(
      join(project, '.personaqa', 'personas', 'james.yaml'),
      james.replace('name: James', 'name: Jim'),
    );

    expect(loader().persona('james').name).toBe('Jim');
  });

  it('detects extends cycles', () => {
    put(join(project, '.personaqa', 'personas', 'a.yaml'), 'id: a\nextends: b\n');
    put(join(project, '.personaqa', 'personas', 'b.yaml'), 'id: b\nextends: a\n');

    expect(() => loader().persona('a')).toThrow(/cycle: a -> b -> a/);
  });

  it('rejects a self-extending persona with nothing to extend', () => {
    put(join(project, '.personaqa', 'personas', 'solo.yaml'), 'id: solo\nextends: solo\n');

    expect(() => loader().persona('solo')).toThrow(/extends itself/);
  });

  it('rejects an overridden built-in that itself extends', () => {
    put(join(builtins, 'priya.yaml'), 'id: priya\nextends: james\n');
    put(join(project, '.personaqa', 'personas', 'priya.yaml'), 'id: priya\nextends: priya\n');

    expect(() => loader().persona('priya')).toThrow(/must not use extends when overridden/);
  });

  it('validates the merged result', () => {
    put(
      join(project, '.personaqa', 'personas', 'bad.yaml'),
      'id: bad\nextends: james\ntraits:\n  reading: devours\n',
    );

    expect(() => loader().persona('bad')).toThrow(/not a valid persona/);
  });

  it('reports unknown personas and mismatched ids', () => {
    expect(() => loader().persona('nobody')).toThrow(/Persona "nobody" not found/);

    put(join(project, '.personaqa', 'personas', 'jim.yaml'), james);
    expect(() => loader().persona('jim')).toThrow(/has id "james" but is named "jim"/);
  });

  it('lists ids from user and built-in folders without duplicates', () => {
    put(join(project, '.personaqa', 'personas', 'james.yml'), james);
    put(join(project, '.personaqa', 'personas', 'notes.txt'), 'ignore me');

    expect(loader().personaIds()).toEqual(['james']);
  });

  it('works without a config file', () => {
    project = join(root, 'bare');

    expect(loader().persona('james').name).toBe('James');
    expect(loader().missionIds()).toEqual([]);
  });
});

describe('missions and selections', () => {
  it('loads a mission', () => {
    expect(loader().mission('checkout').start_url).toBe('/fixtures');
  });

  it('reports unknown missions', () => {
    expect(() => loader().mission('refund')).toThrow(/Mission "refund" not found/);
  });

  it('expands "all" and checks explicit ids', () => {
    expect(loader().select('missions', 'all')).toEqual(['checkout']);
    expect(loader().select('personas', ['james'])).toEqual(['james']);
    expect(() => loader().select('personas', ['james', 'zed'])).toThrow(/Unknown personas: zed/);
  });

  it('wraps YAML syntax errors with the file name', () => {
    put(join(project, '.personaqa', 'missions', 'broken.yaml'), 'id: [unclosed');

    expect(() => loader().mission('broken')).toThrow(/broken\.yaml/);
  });
});

describe('helpers', () => {
  it('interpolates nested strings only', () => {
    expect(interpolate({ a: ['${X}', 2], b: { c: '${Y:-y}' }, d: null }, { X: 'x' })).toEqual({
      a: ['x', 2],
      b: { c: 'y' },
      d: null,
    });
  });

  it('merges deeply without mutating inputs', () => {
    const base = { a: { b: 1, c: [1, 2] } };
    const merged = deepMerge(base, { a: { c: [3] } });

    expect(merged).toEqual({ a: { b: 1, c: [3] } });
    expect(base.a.c).toEqual([1, 2]);
  });
});
