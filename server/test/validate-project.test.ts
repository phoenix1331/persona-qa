import { afterEach, describe, expect, it } from 'vitest';
import { connect, makeProject, persona } from './support/harness.js';

const mission =
  'id: checkout\ngoal: Buy.\nstart_url: /\nsuccess:\n  any:\n    - url_contains: /done\n';

let harness: Awaited<ReturnType<typeof connect>>;

afterEach(async () => {
  await harness.close();
});

describe('validate_project', () => {
  it('reports every file as ok when all is well', async () => {
    harness = await connect(makeProject('http://127.0.0.1:8000', ['127.0.0.1:8000'], mission));

    const { text, isError } = await harness.call('validate_project', {});

    expect(isError).toBe(false);
    expect(text).toContain('ok    config config.yaml');
    expect(text).toContain('ok    persona james');
    expect(text).toContain('ok    mission checkout');
    expect(text).toContain('All 3 files are valid.');
  });

  it('lists every broken file and bad reference, not just the first', async () => {
    const project = makeProject('http://127.0.0.1:8000', ['127.0.0.1:8000'], mission);
    project.write(
      '.personaqa/config.yaml',
      'version: 1\napp:\n  name: T\n  base_url: http://127.0.0.1:8000\n  allowed_domains: [127.0.0.1:8000]\npersonas:\n  enabled: [james, ghost]\nci:\n  nightly:\n    personas: all\n    missions: [refund]\n',
    );
    project.write(
      '.personaqa/personas/bad.yaml',
      persona('bad').replace('reading: skims', 'reading: devours'),
    );
    project.write(
      '.personaqa/personas/phone.yaml',
      'id: phone\nextends: james\nenvironment:\n  preset: mobile-4g\n  device: Nokia 3310\n',
    );
    project.write('.personaqa/missions/empty.yaml', 'id: empty\n');
    harness = await connect(project);

    const { text } = await harness.call('validate_project', {});

    expect(text).toContain('FAIL  persona bad');
    expect(text).toContain('/traits/reading: must be one of: skims, reads, scrutinises');
    expect(text).toContain('FAIL  persona phone');
    expect(text).toContain('Unknown device "Nokia 3310"');
    expect(text).toContain('FAIL  mission empty');
    expect(text).toContain('personas.enabled lists "ghost", which does not exist');
    expect(text).toContain('ci.nightly.missions lists unknown mission "refund"');
    expect(text).toContain('ok    persona james');
    expect(text).toContain('4 problems found.');
  });

  it('stops after a broken config with a clear reason', async () => {
    const project = makeProject('http://127.0.0.1:8000', ['127.0.0.1:8000'], mission);
    project.write('.personaqa/config.yaml', 'version: 2\n');
    harness = await connect(project);

    const { text } = await harness.call('validate_project', {});

    expect(text).toContain('FAIL  config config.yaml');
    expect(text).toContain('1 problem found.');
  });
});
