import { PersonaQAError } from './errors.js';
import type { Loader } from './loader.js';
import type { Selection } from './types.js';
import { newRunId } from './writer.js';

export interface PlanInput {
  /** "all", a comma-separated list of ids, or empty for the config default. */
  personas?: string;
  missions?: string;
  /** Named run set from config `ci`, e.g. pull_request. */
  set?: string;
  base_url?: string;
}

export interface Plan {
  run_id: string;
  base_url: string;
  max_parallel: number;
  model?: string;
  pairs: { persona: string; mission: string }[];
  personas: { id: string; name: string; environment: string }[];
  missions: { id: string; goal: string }[];
  /** Inspectors switched on in config; the run skill narrows these with --with or --no-inspectors. */
  inspectors: { a11y: boolean; ux: boolean };
}

function parse(value: string | undefined): Selection | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return undefined;
  if (trimmed === 'all') return 'all';
  return trimmed
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/** Resolves who runs what, validating every file involved before any browser opens. */
export function plan(
  loader: Loader,
  input: PlanInput,
  describeEnvironment: (id: string) => string,
): Plan {
  const config = loader.config();
  let personaSelection = parse(input.personas);
  let missionSelection = parse(input.missions);

  if (input.set !== undefined && input.set !== '') {
    const set = config.ci[input.set];
    if (set === undefined) {
      const known = Object.keys(config.ci);
      throw new PersonaQAError(
        `No run set "${input.set}" in config ci.${known.length > 0 ? ` Known sets: ${known.join(', ')}` : ' None are defined.'}`,
      );
    }
    personaSelection ??= set.personas;
    missionSelection ??= set.missions;
  }

  const personaIds = loader.select('personas', personaSelection ?? config.personas.enabled);
  const missionIds = loader.select('missions', missionSelection ?? 'all');

  if (personaIds.length === 0) throw new PersonaQAError('No personas selected or enabled.');
  if (missionIds.length === 0)
    throw new PersonaQAError('No missions found. Add one to .personaqa/missions/.');

  const personas = personaIds.map((id) => {
    const persona = loader.persona(id);
    return { id, name: persona.name, environment: describeEnvironment(id) };
  });
  const missions = missionIds.map((id) => ({ id, goal: loader.mission(id).goal.trim() }));

  return {
    run_id: newRunId(),
    base_url: input.base_url ?? config.app.base_url,
    max_parallel: config.runner.max_parallel,
    ...(config.runner.model === undefined ? {} : { model: config.runner.model }),
    pairs: personaIds.flatMap((persona) => missionIds.map((mission) => ({ persona, mission }))),
    personas,
    missions,
    inspectors: { a11y: config.inspectors.a11y.enabled, ux: config.inspectors.ux.enabled },
  };
}
