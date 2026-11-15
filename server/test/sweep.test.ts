import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Project, connect, makeProject } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;
let project: Project;

beforeAll(async () => {
  site = await startSite({
    '/start': html(
      'Start',
      `<main><h1>Fixtures</h1><img src="/x.png">
       <a href="/seat?id=1">Seat 1</a><a href="/seat?id=2">Seat 2</a>
       <a href="/about">About</a><a href="/logout">Sign out</a>
       <a href="https://elsewhere.test/">Partner</a></main>`,
    ),
    '/seat': html('Seat', '<main><h1>Seat</h1><input id="q"></main>'),
    '/about': html('About', '<main><h1>About us</h1><p>Fine.</p></main>'),
    '/logout': html('Bye', '<main><h1>Signed out</h1></main>'),
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness.close();
});

describe('sweep', () => {
  it('scans the start page and one page per same-site path, skipping sign out and other sites', async () => {
    project = makeProject(
      site.url,
      [site.host],
      'id: checkout\ngoal: Go.\nstart_url: /start\nsuccess:\n  any:\n    - url_contains: /never\n',
    );
    harness = await connect(project);

    const { text, isError } = await harness.call('sweep', {});
    const result = JSON.parse(text) as {
      run_id: string;
      folder: string;
      pages: { mission: string; scanned: number; violations: number }[];
    };

    expect(isError).toBe(false);
    expect(result.pages).toEqual([
      { mission: 'checkout', scanned: 3, violations: expect.any(Number) as number },
    ]);
    expect(site.hits.filter((hit) => hit.startsWith('/seat'))).toEqual(['/seat?id=1']);
    expect(site.hits).not.toContain('/logout');

    const dir = join(result.folder, 'sweep--checkout');
    const a11y = JSON.parse(readFileSync(join(dir, 'a11y.json'), 'utf8')) as {
      scans: { url: string }[];
    };
    expect(a11y.scans.map((scan) => new URL(scan.url).pathname)).toEqual([
      '/start',
      '/seat',
      '/about',
    ]);
    expect(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))).toMatchObject({
      persona: 'sweep',
      end_reason: 'accessibility sweep',
    });
    expect(existsSync(join(dir, 'journal.md'))).toBe(true);

    spawnSync(
      process.execPath,
      [join(import.meta.dirname, '../../scripts/report.mjs'), result.folder],
      { encoding: 'utf8' },
    );
    const summary = readFileSync(join(result.folder, 'summary.md'), 'utf8');
    expect(summary).toContain('Accessibility sweep: 3 page states scanned with no persona.');
    expect(summary).not.toContain('unfinished');
  });

  it('respects max_pages and unknown missions', async () => {
    project = makeProject(
      site.url,
      [site.host],
      'id: checkout\ngoal: Go.\nstart_url: /start\nsuccess:\n  any:\n    - url_contains: /never\n',
    );
    harness = await connect(project);

    const capped = JSON.parse((await harness.call('sweep', { max_pages: 1 })).text) as {
      pages: { scanned: number }[];
    };
    const unknown = await harness.call('sweep', { missions: 'refund' });

    expect(capped.pages[0]?.scanned).toBe(1);
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('Unknown missions: refund');
  });
});
