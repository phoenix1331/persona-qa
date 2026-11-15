import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { criteriaFrom, tagsFor } from '../src/audit.js';
import { type Project, connect, makeProject, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;
let project: Project;

beforeAll(async () => {
  site = await startSite({
    '/bad': html(
      'Bad',
      `<main><h1>Tickets</h1>
       <img src="/x.png">
       <p style="color:#bbb;background:#fff">Faint small print</p>
       <input id="cvc">
       <a href="/bad?again">Same page again</a>
       <a href="/good">Good page</a></main>`,
    ),
    '/good': html('Good', '<main><h1>All fine</h1><p>Readable text.</p></main>'),
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

async function open(inspectors = '') {
  project = makeProject(
    site.url,
    [site.host],
    'id: checkout\ngoal: Go.\nstart_url: /bad\nsuccess:\n  any:\n    - url_contains: /never\n',
  );
  const config = readFileSync(join(project.dir, '.personaqa/config.yaml'), 'utf8');
  project.write('.personaqa/config.yaml', `${config}${inspectors}`);
  harness = await connect(project);
  const { text } = await harness.call('start_session', {
    persona: 'james',
    mission: 'checkout',
    run_id: 'a11y',
  });
  const id = sessionIdFrom(text);
  const screen = (await harness.call('look', { session: id })).text;
  const ref = (label: string) =>
    new RegExp(`\\[(e\\d+) link "${label}"`).exec(screen)?.[1] ?? 'missing';
  return { id, ref, session: () => harness.sessions.get(id) };
}

describe('ride-along accessibility scans', () => {
  it('scans the start page and maps violations to WCAG criteria', async () => {
    const { session } = await open();

    const scans = session().a11yScans;
    expect(scans).toHaveLength(1);
    const rules = Object.fromEntries(
      (scans[0]?.violations ?? []).map((violation) => [violation.rule, violation.wcag]),
    );
    expect(rules['image-alt']).toContain('1.1.1');
    expect(rules['color-contrast']).toContain('1.4.3');
    expect(Object.keys(rules)).toContain('label');
    expect(scans[0]?.screenshot).toMatch(/^screenshots\/\d{3}-a11y-1\.jpg$/);
  });

  it('scans each new state once and writes a11y.json on finish', async () => {
    const { id, ref, session } = await open();

    const again = await harness.call('tap', { session: id, ref: ref('Same page again') });
    expect(session().a11yScans).toHaveLength(1);

    const screen = again.text;
    const good = /\[(e\d+) link "Good page"\]/.exec(screen)?.[1] ?? 'missing';
    await harness.call('tap', { session: id, ref: good });
    expect(session().a11yScans).toHaveLength(2);
    expect(session().a11yScans[1]?.violations).toEqual([]);

    await harness.call('finish', { session: id, journal: 'Done.' });
    const written = JSON.parse(
      readFileSync(join(project.dir, '.personaqa/runs/a11y/james--checkout/a11y.json'), 'utf8'),
    ) as { standard: string; level: string; scans: unknown[] };
    expect(written).toMatchObject({ standard: 'wcag22', level: 'AA' });
    expect(written.scans).toHaveLength(2);
  });

  it('honours ignore rules and can be switched off', async () => {
    const ignoring = await open('inspectors:\n  a11y:\n    ignore: [color-contrast]\n');
    expect(
      ignoring.session().a11yScans[0]?.violations.map((violation) => violation.rule),
    ).not.toContain('color-contrast');
    await harness.close();

    const off = await open('inspectors:\n  a11y:\n    enabled: false\n');
    expect(off.session().a11yScans).toEqual([]);
  });

  it('runs on demand through the audit tool', async () => {
    const { id } = await open('inspectors:\n  a11y:\n    mode: sweep\n');

    const result = await harness.call('audit', { session: id });

    expect(result.text).toMatch(/automated WCAG violations? on http/);
    expect(result.text).toContain('image-alt (critical, WCAG 1.1.1)');
  });
});

describe('WCAG helpers', () => {
  it('maps axe tags to success criteria', () => {
    expect(criteriaFrom(['wcag2aa', 'wcag143', 'wcag2411', 'cat.color'])).toEqual([
      '1.4.3',
      '2.4.11',
    ]);
  });

  it('chooses tags for the configured standard and level', () => {
    expect(tagsFor('wcag22', 'AA')).toEqual([
      'wcag2a',
      'wcag21a',
      'wcag2aa',
      'wcag21aa',
      'wcag22aa',
    ]);
    expect(tagsFor('wcag21', 'A')).toEqual(['wcag2a', 'wcag21a']);
  });
});

describe('page outline for inspectors', () => {
  it('stores the whole page as text with each scan', async () => {
    const { session } = await open();

    expect(session().a11yScans[0]?.outline).toMatch(
      /# Tickets[\s\S]*\[image with no description\][\s\S]*\[e\d+ textbox \(no name\)\]/,
    );
  });
});
