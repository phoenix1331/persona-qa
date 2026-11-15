import { PersonaQAError } from './errors.js';
import { resolveEnvironment } from './environment.js';
import type { Loader } from './loader.js';

export interface FileReport {
  kind: 'config' | 'persona' | 'mission';
  id: string;
  ok: boolean;
  problems: string[];
}

export interface ProjectReport {
  ok: boolean;
  files: FileReport[];
  /** Selections in config that point at things that do not exist. */
  references: string[];
}

function problemsOf(error: unknown): string[] {
  if (error instanceof PersonaQAError) {
    return error
      .describe()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
  return [(error as Error).message];
}

function check(kind: FileReport['kind'], id: string, action: () => void): FileReport {
  try {
    action();
    return { kind, id, ok: true, problems: [] };
  } catch (error) {
    return { kind, id, ok: false, problems: problemsOf(error) };
  }
}

/** Checks every config, persona and mission file and reports them all, rather than stopping at the first problem. */
export function validateProject(loader: Loader): ProjectReport {
  const configReport = check('config', 'config.yaml', () => loader.config());
  const files: FileReport[] = [configReport];
  const references: string[] = [];

  if (!configReport.ok) {
    return { ok: false, files, references };
  }

  for (const id of loader.personaIds()) {
    files.push(
      check('persona', id, () => {
        resolveEnvironment(loader.persona(id).environment);
      }),
    );
  }

  for (const id of loader.missionIds()) {
    files.push(check('mission', id, () => loader.mission(id)));
  }

  const config = loader.config();
  const personaIds = new Set(loader.personaIds());
  const missionIds = new Set(loader.missionIds());
  const missing = (ids: 'all' | string[], known: Set<string>): string[] =>
    ids === 'all' ? [] : ids.filter((id) => !known.has(id));

  for (const id of missing(config.personas.enabled, personaIds)) {
    references.push(`personas.enabled lists "${id}", which does not exist`);
  }
  for (const [name, set] of Object.entries(config.ci)) {
    for (const id of missing(set.personas, personaIds))
      references.push(`ci.${name}.personas lists unknown persona "${id}"`);
    for (const id of missing(set.missions, missionIds))
      references.push(`ci.${name}.missions lists unknown mission "${id}"`);
  }
  if (
    config.auth.strategy === 'login_mission' &&
    config.auth.login_mission !== undefined &&
    !missionIds.has(config.auth.login_mission)
  ) {
    references.push(`auth.login_mission "${config.auth.login_mission}" does not exist`);
  }

  return { ok: files.every((file) => file.ok) && references.length === 0, files, references };
}

export function formatReport(report: ProjectReport): string {
  const lines = report.files.map((file) =>
    file.ok
      ? `ok    ${file.kind} ${file.id}`
      : [`FAIL  ${file.kind} ${file.id}`, ...file.problems.map((p) => `        ${p}`)].join('\n'),
  );
  if (report.references.length > 0) {
    lines.push('FAIL  references', ...report.references.map((reference) => `        ${reference}`));
  }
  const failed =
    report.files.filter((file) => !file.ok).length + (report.references.length > 0 ? 1 : 0);
  lines.push(
    '',
    report.ok
      ? `All ${report.files.length} files are valid.`
      : `${failed} problem${failed === 1 ? '' : 's'} found.`,
  );
  return lines.join('\n');
}
