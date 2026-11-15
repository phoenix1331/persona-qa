import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { PersonaQAError } from './errors.js';
import type { Config, Mission, Persona } from './types.js';
import { type SchemaKind, validate } from './validation.js';

type Env = Record<string, string | undefined>;
type Plain = Record<string, unknown>;

export interface LoaderOptions {
  /** Repository root that holds `.personaqa/`. */
  projectDir: string;
  /** Plugin's built-in persona directory, searched after the user's paths. */
  builtinPersonaDir: string;
  env?: Env;
}

const YAML_EXTENSIONS = ['.yaml', '.yml'];

export class Loader {
  private readonly env: Env;
  private configCache: Config | undefined;

  constructor(private readonly options: LoaderOptions) {
    this.env = options.env ?? process.env;
  }

  config(): Config {
    this.configCache ??= this.readConfig();
    return this.configCache;
  }

  persona(id: string): Persona {
    return this.resolvePersona(id, []);
  }

  mission(id: string): Mission {
    const file = this.find(id, this.missionDirs());
    if (file === undefined) {
      throw new PersonaQAError(`Mission "${id}" not found in ${this.missionDirs().join(', ')}`);
    }

    return this.readValidated<Mission>(file, 'mission', id);
  }

  personaIds(): string[] {
    return this.idsIn(this.personaDirs());
  }

  missionIds(): string[] {
    return this.idsIn(this.missionDirs());
  }

  /** Expands a selection ("all" or explicit ids) against what exists on disk. */
  select(kind: 'personas' | 'missions', selection: 'all' | string[]): string[] {
    const available = kind === 'personas' ? this.personaIds() : this.missionIds();
    if (selection === 'all') {
      return available;
    }

    const missing = selection.filter((id) => !available.includes(id));
    if (missing.length > 0) {
      throw new PersonaQAError(
        `Unknown ${kind}: ${missing.join(', ')}. Available: ${available.join(', ')}`,
      );
    }

    return selection;
  }

  private readConfig(): Config {
    const file = join(this.options.projectDir, '.personaqa', 'config.yaml');
    if (!existsSync(file)) {
      throw new PersonaQAError(`No config found at ${file}. Run /personaqa:init first.`);
    }

    return withConfigDefaults(this.readValidated<Plain>(file, 'config'));
  }

  private resolvePersona(id: string, chain: string[]): Persona {
    if (chain.includes(id)) {
      throw new PersonaQAError(`Persona "extends" cycle: ${[...chain, id].join(' -> ')}`);
    }

    const dirs = this.personaDirs();
    const file = this.find(id, dirs);
    if (file === undefined) {
      throw new PersonaQAError(`Persona "${id}" not found in ${dirs.join(', ')}`);
    }

    const raw = this.readValidated<Plain>(file, 'persona', id);
    const parentId = typeof raw['extends'] === 'string' ? raw['extends'] : undefined;

    if (parentId === undefined) {
      return { ...(raw as unknown as Omit<Persona, 'sources'>), sources: [file] };
    }

    const parent = this.resolveParent(parentId, file, [...chain, id]);
    const own = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'extends'));
    const { sources, ...parentFields } = parent;
    const merged = deepMerge(parentFields as Plain, own);

    const result = validate('persona', merged);
    if (!result.valid) {
      throw new PersonaQAError(
        `Persona "${id}" is invalid after applying extends: ${parentId}`,
        result.issues,
      );
    }

    return { ...(merged as unknown as Omit<Persona, 'sources'>), sources: [file, ...sources] };
  }

  /** A persona may extend a built-in with the same id (an override), so skip its own file. */
  private resolveParent(parentId: string, childFile: string, chain: string[]): Persona {
    const childId = chain[chain.length - 1];
    if (parentId !== childId) {
      return this.resolvePersona(parentId, chain);
    }

    const file = this.find(
      parentId,
      this.personaDirs().filter((dir) => !childFile.startsWith(dir)),
    );
    if (file === undefined) {
      throw new PersonaQAError(
        `Persona "${parentId}" extends itself but no other "${parentId}" exists`,
      );
    }

    const raw = this.readValidated<Plain>(file, 'persona', parentId);
    if (typeof raw['extends'] === 'string') {
      throw new PersonaQAError(
        `Persona "${parentId}" in ${file} must not use extends when overridden`,
      );
    }

    return { ...(raw as unknown as Omit<Persona, 'sources'>), sources: [file] };
  }

  private readValidated<T>(file: string, kind: SchemaKind, expectedId?: string): T {
    let data: unknown;
    try {
      data = interpolate(parse(readFileSync(file, 'utf8')), this.env);
    } catch (error) {
      if (error instanceof PersonaQAError) {
        throw new PersonaQAError(`${file}: ${error.message}`);
      }
      throw new PersonaQAError(`${file}: ${(error as Error).message}`);
    }

    const result = validate(kind, data);
    if (!result.valid) {
      throw new PersonaQAError(`${file} is not a valid ${kind}`, result.issues);
    }

    const id = (data as Plain)['id'];
    if (expectedId !== undefined && id !== expectedId) {
      throw new PersonaQAError(`${file} has id "${String(id)}" but is named "${expectedId}"`);
    }

    return data as T;
  }

  private personaDirs(): string[] {
    const paths = this.configOrNull()?.personas.paths ?? ['.personaqa/personas'];
    return [...paths.map((path) => this.absolute(path)), this.options.builtinPersonaDir];
  }

  private missionDirs(): string[] {
    const paths = this.configOrNull()?.missions.paths ?? ['.personaqa/missions'];
    return paths.map((path) => this.absolute(path));
  }

  private configOrNull(): Config | null {
    const file = join(this.options.projectDir, '.personaqa', 'config.yaml');
    return existsSync(file) ? this.config() : null;
  }

  private absolute(path: string): string {
    return isAbsolute(path) ? path : resolve(this.options.projectDir, path);
  }

  private find(id: string, dirs: string[]): string | undefined {
    for (const dir of dirs) {
      for (const extension of YAML_EXTENSIONS) {
        const file = join(dir, `${id}${extension}`);
        if (existsSync(file)) {
          return file;
        }
      }
    }

    return undefined;
  }

  private idsIn(dirs: string[]): string[] {
    const ids = new Set<string>();
    for (const dir of dirs.filter((path) => existsSync(path))) {
      for (const entry of readdirSync(dir)) {
        if (YAML_EXTENSIONS.includes(extname(entry))) {
          ids.add(basename(entry, extname(entry)));
        }
      }
    }

    return [...ids].sort();
  }
}

/** Replaces ${NAME} and ${NAME:-fallback} in string values. Unset names without a fallback are errors. */
export function interpolate(value: unknown, env: Env): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g,
      (_match, name: string, fallback?: string) => {
        const found = env[name];
        if (found !== undefined && found !== '') {
          return found;
        }
        if (fallback !== undefined) {
          return fallback;
        }
        throw new PersonaQAError(`environment variable ${name} is not set`);
      },
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, env));
  }

  if (isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, env)]),
    );
  }

  return value;
}

/** Objects merge key by key; arrays and scalars from `override` replace the base. */
export function deepMerge(base: Plain, override: Plain): Plain {
  const result: Plain = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = isPlain(existing) && isPlain(value) ? deepMerge(existing, value) : value;
  }

  return result;
}

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function withConfigDefaults(raw: Plain): Config {
  const defaults = {
    auth: { strategy: 'none', accounts: {} },
    runner: { max_parallel: 3, max_steps_per_run: 60, max_minutes_per_run: 8 },
    personas: { enabled: 'all', paths: ['.personaqa/personas'] },
    missions: { paths: ['.personaqa/missions'] },
    output: {
      dir: '.personaqa/runs',
      screenshots: 'on_issue',
      trace: 'on_failure',
      regression_tests: 'suggest',
    },
    issues: { sink: 'file', github: { labels: ['personaqa'], min_severity: 'medium' } },
    ci: {},
    inspectors: {
      a11y: { enabled: true, standard: 'wcag22', level: 'AA', mode: 'ride_along', ignore: [] },
      ux: { enabled: true, heuristics: 'nielsen' },
    },
  };

  return deepMerge(defaults, raw) as unknown as Config;
}
