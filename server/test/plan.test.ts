import { afterEach, describe, expect, it } from 'vitest';
import { connect, makeProject, persona } from './support/harness.js';

const mission = (id: string): string =>
  `id: ${id}\ngoal: Do ${id}.\nstart_url: /\nsuccess:\n  any:\n    - url_contains: /done\n`;

let harness: Awaited<ReturnType<typeof connect>>;

afterEach(async () => {
  await harness.close();
});

async function setup(extraConfig = '') {
  const project = makeProject('http://127.0.0.1:8000', ['127.0.0.1:8000'], mission('checkout'));
  project.write('.personaqa/missions/signup.yaml', mission('signup'));
  project.write('builtin:priya.yaml', persona('priya').replace('name: James', 'name: Priya'));
  project.write(
    '.personaqa/config.yaml',
    `version: 1\napp:\n  name: Test\n  base_url: http://127.0.0.1:8000\n  allowed_domains: [127.0.0.1:8000]\nrunner:\n  max_parallel: 2\n${extraConfig}`,
  );
  harness = await connect(project);
  return project;
}

async function planWith(args: Record<string, unknown>) {
  const result = await harness.call('plan_run', args);
  return {
    ...result,
    plan: result.isError ? undefined : (JSON.parse(result.text) as Record<string, unknown>),
  };
}

describe('plan_run', () => {
  it('runs every enabled persona against every mission by default', async () => {
    await setup();

    const { plan } = await planWith({});

    expect(plan).toMatchObject({
      base_url: 'http://127.0.0.1:8000',
      max_parallel: 2,
      pairs: [
        { persona: 'james', mission: 'checkout' },
        { persona: 'james', mission: 'signup' },
        { persona: 'priya', mission: 'checkout' },
        { persona: 'priya', mission: 'signup' },
      ],
      personas: [
        { id: 'james', name: 'James', environment: 'desktop, mouse, fast connection' },
        { id: 'priya', name: 'Priya', environment: 'desktop, mouse, fast connection' },
      ],
    });
    expect(plan?.['run_id']).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/);
  });

  it('accepts explicit comma-separated selections and a base URL override', async () => {
    await setup();

    const { plan } = await planWith({
      personas: 'priya',
      missions: 'signup, checkout',
      base_url: 'https://pr-12.preview.test',
    });

    expect(plan?.['pairs']).toEqual([
      { persona: 'priya', mission: 'signup' },
      { persona: 'priya', mission: 'checkout' },
    ]);
    expect(plan?.['base_url']).toBe('https://pr-12.preview.test');
  });

  it('uses a named run set from config', async () => {
    await setup('ci:\n  pull_request:\n    personas: [james]\n    missions: [checkout]\n');

    const { plan } = await planWith({ set: 'pull_request' });

    expect(plan?.['pairs']).toEqual([{ persona: 'james', mission: 'checkout' }]);
  });

  it('respects personas.enabled', async () => {
    await setup('personas:\n  enabled: [priya]\n');

    const { plan } = await planWith({ missions: 'checkout' });

    expect(plan?.['pairs']).toEqual([{ persona: 'priya', mission: 'checkout' }]);
  });

  it('explains unknown ids, sets and invalid files before anything runs', async () => {
    const project = await setup();
    project.write('.personaqa/missions/broken.yaml', 'id: broken\ngoal: x\n');

    const unknownPersona = await planWith({ personas: 'zed' });
    const unknownSet = await planWith({ set: 'nightly' });
    const broken = await planWith({ missions: 'broken' });

    expect(unknownPersona.text).toContain('Unknown personas: zed. Available: james, priya');
    expect(unknownSet.text).toContain('No run set "nightly" in config ci. None are defined.');
    expect(broken.text).toContain('missing required field "start_url"');
    expect([unknownPersona, unknownSet, broken].every((result) => result.isError)).toBe(true);
  });
});
