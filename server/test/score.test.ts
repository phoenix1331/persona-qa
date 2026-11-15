import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '../../scripts/score.mjs');

const flaws = `
flaws:
  - id: F01
    title: Cookie banner covers Pay
    category: ux
    match:
      - ["cookie", "pay"]
      - ["banner", "cover"]
  - id: F05
    title: Hidden fee
    category: ux
    match:
      - ["fee"]
  - id: F10
    title: Date picker trap
    category: a11y
    match:
      - ["keyboard trap"]
      - ["2.1.2"]
  - id: F99
    title: No rules
    category: ux
`;

function run(files: Record<string, unknown>): { stdout: string; score: Record<string, unknown> } {
  const root = mkdtempSync(join(tmpdir(), 'personaqa-score-'));
  const runDir = join(root, 'run');
  mkdirSync(join(runDir, 'james--checkout'), { recursive: true });
  for (const [path, value] of Object.entries(files))
    writeFileSync(join(runDir, path), JSON.stringify(value));
  writeFileSync(join(root, 'flaws.yaml'), flaws);
  const result = spawnSync(process.execPath, [script, runDir, join(root, 'flaws.yaml')], {
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout,
    score: JSON.parse(readFileSync(join(runDir, 'score.json'), 'utf8')) as Record<string, unknown>,
  };
}

describe('score.mjs', () => {
  it('counts a flaw when any match group is fully present across findings and inspectors', () => {
    const { stdout, score } = run({
      'james--checkout/issues.json': {
        issues: [
          {
            id: 'james-checkout-1',
            title: 'Pay button hidden',
            what_happened: 'The cookie notice sat on top.',
            expected: 'Visible',
          },
        ],
      },
      'findings.json': {
        findings: [
          {
            title: 'Pay hidden on phones',
            summary: 'A cookie banner covers it.',
            personas: ['james'],
            evidence: ['james-checkout-1'],
          },
          { title: 'Search is slow', summary: 'Unrelated.', personas: ['margaret'], evidence: [] },
        ],
      },
      'a11y.json': {
        findings: [
          {
            title: 'Date picker traps focus',
            detail: 'Tab cycles inside.',
            tags: ['WCAG 2.1.2'],
            personas: ['priya'],
          },
        ],
      },
    });

    expect(score).toMatchObject({
      found: 2,
      total: 4,
      categories: [
        { category: 'ux', found: 1, total: 3 },
        { category: 'a11y', found: 1, total: 1 },
      ],
      unscorable: ['F99'],
    });
    expect(score['unmatched_findings']).toEqual(['finding "Search is slow"']);
    expect(stdout).toContain('## Found 2 of 4 planted flaws (50%)');
    expect(stdout).toContain('| F01 Cookie banner covers Pay | yes | 1 | james |');
    expect(stdout).toContain('Flaws with no match rules, so never counted: F99.');
  });

  it('scores raw issues when the coordinator has not run', () => {
    const { score } = run({
      'james--checkout/issues.json': {
        issues: [
          {
            id: 'james-checkout-1',
            title: 'Surprise fee',
            what_happened: '£2.50 more',
            expected: 'Total up front',
          },
        ],
      },
    });

    expect(score['found']).toBe(1);
    expect(
      (score['flaws'] as { id: string; by: string[] }[]).find((flaw) => flaw.id === 'F05')?.by,
    ).toEqual(['issue james-checkout-1']);
  });
});
