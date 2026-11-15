import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = join(import.meta.dirname, '../../scripts');

function node(
  script: string,
  ...args: string[]
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PERSONAQA_TRIAGE: '' },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

/** A project with .personaqa/runs/<id>/ holding one session and coordinator findings. */
function project(): { root: string; run: (id: string, known?: string) => string } {
  const root = mkdtempSync(join(tmpdir(), 'personaqa-triage-'));
  mkdirSync(join(root, '.personaqa'), { recursive: true });
  writeFileSync(join(root, '.personaqa', 'config.yaml'), 'version: 1\napp:\n  name: Shop\n');

  const run = (id: string, known?: string): string => {
    const runDir = join(root, '.personaqa', 'runs', id);
    const session = join(runDir, 'priya--checkout');
    mkdirSync(session, { recursive: true });
    writeFileSync(
      join(session, 'run.json'),
      JSON.stringify({
        persona: 'priya',
        mission: 'checkout',
        outcome: 'abandoned',
        steps: 5,
        longest_wait_seconds: 1,
        environment: 'desktop, keyboard only',
        base_url: 'https://staging.shop.test',
      }),
    );
    writeFileSync(join(session, 'journal.md'), '# Priya - checkout\n\n## Journal\n\nStuck.\n');
    writeFileSync(
      join(session, 'issues.json'),
      JSON.stringify({
        issues: [
          {
            id: 'priya-checkout-1',
            step: 3,
            severity: 'high',
            title: 'Trapped in date picker',
            what_happened: 'Tab cycled forever',
            expected: 'Escape closes it',
            url: '/fixtures',
          },
          {
            id: 'priya-checkout-2',
            step: 4,
            severity: 'low',
            title: 'Footer hard to read',
            what_happened: 'Faint',
            expected: 'Readable',
            url: '/fixtures',
          },
        ],
      }),
    );
    writeFileSync(
      join(runDir, 'findings.json'),
      JSON.stringify({
        findings: [
          {
            title: 'Date picker traps keyboard focus',
            severity: 'high',
            category: 'a11y',
            summary: 'Fails WCAG 2.1.2.',
            suggested_fix: 'Close on Escape.',
            evidence: ['priya-checkout-1'],
          },
          {
            title: 'Footer text has low contrast',
            severity: 'low',
            category: 'a11y',
            summary: 'Fails 1.4.3.',
            evidence: ['priya-checkout-2'],
            ...(known === undefined ? {} : { known }),
          },
        ],
      }),
    );
    node('report.mjs', runDir);
    return runDir;
  };

  return { root, run };
}

describe('triage.mjs', () => {
  it('remembers a dismissal so the same finding is hidden in later runs', () => {
    const { root, run } = project();
    const first = run('run-1');

    const dismissed = JSON.parse(
      node('triage.mjs', 'dismiss', first, 'ISSUE-2', 'Brand colours, accepted').stdout,
    ) as { key: string };
    node('report.mjs', first);

    expect(dismissed.key).toBe('footer-text-has-low-contrast');
    const triage = JSON.parse(readFileSync(join(root, '.personaqa', 'triage.json'), 'utf8')) as {
      findings: Record<string, { status: string; reason: string }>;
    };
    expect(triage.findings['footer-text-has-low-contrast']).toMatchObject({
      status: 'dismissed',
      reason: 'Brand colours, accepted',
    });
    expect(readFileSync(join(first, 'summary.md'), 'utf8')).toContain(
      '1 previously dismissed finding is hidden.',
    );

    const second = run('run-2', 'footer-text-has-low-contrast');
    const report = JSON.parse(readFileSync(join(second, 'report.json'), 'utf8')) as {
      findings: { title: string; id: string }[];
      dismissed: number;
    };
    expect(report.findings.map((finding) => finding.title)).toEqual([
      'Date picker traps keyboard focus',
    ]);
    expect(report.dismissed).toBe(1);
  });

  it('prepares GitHub issues for confirmed findings with a11y and WCAG labels, once', () => {
    const { run } = project();
    const runDir = run('run-1');

    expect(JSON.parse(node('triage.mjs', 'github', runDir).stdout)).toEqual([]);

    node('triage.mjs', 'confirm', runDir, 'ISSUE-1');
    const candidates = JSON.parse(
      node('triage.mjs', 'github', runDir, '--labels', 'personaqa,ux').stdout,
    ) as { id: string; title: string; labels: string[]; body: string }[];

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'ISSUE-1',
      title: '[PersonaQA] Date picker traps keyboard focus',
      labels: ['personaqa', 'ux', 'a11y', 'wcag-2.1.2'],
    });
    expect(candidates[0]?.body).toContain(
      '**Severity:** high · **Category:** a11y · **Personas affected:** Priya',
    );
    expect(candidates[0]?.body).toContain('- **priya--checkout**, step 3, `/fixtures`');
    expect(candidates[0]?.body).toContain('/personaqa:test ISSUE-1');

    node('triage.mjs', 'filed', runDir, 'ISSUE-1', 'https://github.com/o/r/issues/7');
    expect(JSON.parse(node('triage.mjs', 'github', runDir).stdout)).toEqual([]);
  });

  it('files everything at or above the minimum severity with --all, and explains unknown ids', () => {
    const { run } = project();
    const runDir = run('run-1');

    const all = JSON.parse(
      node('triage.mjs', 'github', runDir, '--all', '--min-severity', 'medium').stdout,
    ) as { id: string }[];
    const unknown = node('triage.mjs', 'confirm', runDir, 'ISSUE-9');

    expect(all.map((candidate) => candidate.id)).toEqual(['ISSUE-1']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('No ISSUE-9 in this run. Available: ISSUE-1, ISSUE-2');
    expect(existsSync(join(runDir, 'report.json'))).toBe(true);
  });
});
