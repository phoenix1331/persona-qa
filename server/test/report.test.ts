import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '../../scripts/report.mjs');

interface Session {
  dir: string;
  outcome: string;
  issues: { id: string; severity: string; title: string }[];
}

function fixture(sessions: Session[], extra: Record<string, unknown> = {}): string {
  const project = mkdtempSync(join(tmpdir(), 'personaqa-report-'));
  writeFileSync(join(project, 'config.yaml'), 'version: 1\napp:\n  name: Matchday Tickets\n');
  const runDir = join(project, 'runs', '2026-11-15T13-00-00');
  for (const session of sessions) {
    const [persona, mission] = session.dir.split('--');
    mkdirSync(join(runDir, session.dir, 'screenshots'), { recursive: true });
    writeFileSync(join(runDir, session.dir, 'screenshots', '001-final.jpg'), 'jpg');
    writeFileSync(
      join(runDir, session.dir, 'run.json'),
      JSON.stringify({
        persona,
        mission,
        outcome: session.outcome,
        end_reason: 'x',
        steps: 9,
        duration_seconds: 60,
        longest_wait_seconds: 8.5,
        environment: 'phone',
        base_url: 'http://127.0.0.1:8000',
      }),
    );
    writeFileSync(
      join(runDir, session.dir, 'issues.json'),
      JSON.stringify({
        issues: session.issues.map((issue) => ({
          ...issue,
          step: 3,
          what_happened: `${issue.title} happened`,
          expected: 'Better',
          url: '/checkout',
          screenshot: 'screenshots/001-final.jpg',
        })),
      }),
    );
    writeFileSync(
      join(runDir, session.dir, 'journal.md'),
      `# ${persona === 'james' ? 'James' : 'Margaret'} - ${mission}\n\n## Journal\n\nIt was <b>slow</b>.\n`,
    );
  }
  for (const [name, value] of Object.entries(extra))
    writeFileSync(join(runDir, name), JSON.stringify(value));
  return runDir;
}

function render(runDir: string): {
  data: Record<string, unknown> & { findings: Record<string, unknown>[] };
  html: string;
  summary: string;
  status: number | null;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [script, runDir], { encoding: 'utf8' });
  const html = readFileSync(join(runDir, 'report.html'), 'utf8');
  const json =
    /<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)?.[1] ?? '{}';
  return {
    data: JSON.parse(json) as never,
    html,
    summary: readFileSync(join(runDir, 'summary.md'), 'utf8'),
    status: result.status,
    stderr: result.stderr,
  };
}

const sessions: Session[] = [
  {
    dir: 'james--checkout',
    outcome: 'abandoned',
    issues: [
      { id: 'james-checkout-1', severity: 'high', title: 'Pay hidden by banner' },
      { id: 'james-checkout-2', severity: 'low', title: 'Odd alt text' },
    ],
  },
  {
    dir: 'margaret--checkout',
    outcome: 'success',
    issues: [{ id: 'margaret-checkout-1', severity: 'high', title: 'Pay button covered' }],
  },
];

describe('report.mjs', () => {
  it('ranks coordinated findings by severity times personas affected', () => {
    const runDir = fixture(sessions, {
      'findings.json': {
        findings: [
          {
            title: 'Odd alt text',
            severity: 'low',
            category: 'a11y',
            summary: 'Alt is a file name.',
            evidence: ['james-checkout-2'],
          },
          {
            title: 'Cookie banner covers Pay',
            severity: 'high',
            category: 'ux',
            summary: 'Both hit it.',
            suggested_fix: 'Move the banner.',
            evidence: ['james-checkout-1', 'margaret-checkout-1'],
          },
        ],
      },
    });

    const { data, status } = render(runDir);

    expect(status).toBe(0);
    expect(data['app']).toBe('Matchday Tickets');
    expect(data['coordinated']).toBe(true);
    expect(
      data.findings.map((finding) => [finding['id'], finding['title'], finding['personas']]),
    ).toEqual([
      ['ISSUE-1', 'Cookie banner covers Pay', ['james', 'margaret']],
      ['ISSUE-2', 'Odd alt text', ['james']],
    ]);
  });

  it('falls back to raw issues, writes a PR-ready summary and escapes page content', () => {
    const runDir = fixture(sessions);

    const { data, html, summary } = render(runDir);

    expect(data['coordinated']).toBe(false);
    expect(data.findings).toHaveLength(3);
    expect(summary).toContain('## PersonaQA: Matchday Tickets');
    expect(summary).toContain(
      '2 sessions: 1 reached the goal, 1 gave up, 0 hit a limit, 0 unfinished.',
    );
    expect(summary).toContain('### Top findings (not yet merged by the coordinator)');
    expect(summary).toContain('| James | checkout | abandoned | 9 | 8.5s |');
    expect(summary).toContain('Estimated model cost: not recorded.');
    expect(html).not.toContain('{{');
    expect(html).not.toContain('<b>slow</b>');
    expect(html).toContain('data:image/webp;base64,');
  });

  it('estimates cost as a range from recorded tokens', () => {
    const runDir = fixture(sessions);
    writeFileSync(
      join(runDir, 'usage.json'),
      JSON.stringify([
        { persona: 'james', mission: 'checkout', model: 'sonnet', total_tokens: 1_000_000 },
        { persona: 'margaret', mission: 'checkout', model: 'haiku', total_tokens: 2_000_000 },
      ]),
    );

    const { summary } = render(runDir);

    expect(summary).toContain(
      'Estimated model cost: $0.12 to $2.20 (3,000,000 tokens as reported by Claude Code).',
    );
  });

  it('warns about findings citing unknown issues', () => {
    const runDir = fixture(sessions, {
      'findings.json': {
        findings: [{ title: 'Ghost', severity: 'medium', evidence: ['nobody-1'] }],
      },
    });

    const { stderr, data } = render(runDir);

    expect(stderr).toContain('cites unknown issue nobody-1');
    expect(data.findings[0]?.['evidence']).toEqual([]);
  });
});
