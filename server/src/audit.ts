import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { runtimeResolve } from './playwright.js';
import type { Session } from './sessions.js';
import { pageOutline } from './snapshot.js';
import type { Config } from './types.js';

export interface A11yNode {
  target: string;
  html: string;
  summary: string;
}

export interface A11yViolation {
  rule: string;
  impact: string;
  help: string;
  help_url: string;
  /** WCAG success criteria such as "1.4.3". */
  wcag: string[];
  nodes: A11yNode[];
}

export interface A11yScan {
  step: number;
  url: string;
  state: string;
  screenshot?: string;
  /** Text outline of the whole page for manual-style review. */
  outline: string;
  violations: A11yViolation[];
}

type A11yConfig = Config['inspectors']['a11y'];

const LEVEL_TAGS: Record<A11yConfig['level'], string[]> = {
  A: ['wcag2a', 'wcag21a'],
  AA: ['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa'],
  AAA: ['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa', 'wcag2aaa'],
};

export function tagsFor(standard: A11yConfig['standard'], level: A11yConfig['level']): string[] {
  const tags = [...LEVEL_TAGS[level]];
  if (standard === 'wcag22' && level !== 'A') tags.push('wcag22aa');
  return tags;
}

/** axe tags such as "wcag143" become success criteria such as "1.4.3". */
export function criteriaFrom(tags: string[]): string[] {
  return tags
    .map((tag) => /^wcag(\d)(\d)(\d+)$/.exec(tag))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]}.${match[2]}.${match[3]}`);
}

let source: string | undefined;

function axeSource(): string {
  source ??= readFileSync(runtimeResolve('axe-core/axe.min.js'), 'utf8');
  return source;
}

interface RawViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: { target: unknown[]; html: string; failureSummary?: string }[];
}

/** Runs axe on the current page. Evaluated rather than added as a script tag so page CSP cannot block it. */
export async function scan(page: Page, config: A11yConfig): Promise<A11yViolation[]> {
  const present = await page.evaluate(() => 'axe' in window);
  if (!present) {
    await page.evaluate(axeSource());
  }

  const raw = await page.evaluate(
    async ({ tags, ignore }) => {
      const axe = (
        window as unknown as {
          axe: { run: (context: unknown, options: unknown) => Promise<{ violations: unknown[] }> };
        }
      ).axe;
      const result = await axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        rules: Object.fromEntries(ignore.map((id) => [id, { enabled: false }])),
        resultTypes: ['violations'],
      });
      return result.violations;
    },
    { tags: tagsFor(config.standard, config.level), ignore: config.ignore },
  );

  return (raw as RawViolation[]).map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    help_url: violation.helpUrl,
    wcag: criteriaFrom(violation.tags),
    nodes: violation.nodes.slice(0, 10).map((node) => ({
      target: node.target.map(String).join(' '),
      html: node.html.length > 200 ? `${node.html.slice(0, 199)}…` : node.html,
      summary: (node.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
    })),
  }));
}

/** Identifies a page state: same path, headings, dialogs and alerts means the same state. */
export async function stateKey(page: Page): Promise<string> {
  const signature = await page.evaluate(() => {
    const text = (selector: string): string =>
      Array.from(document.querySelectorAll(selector))
        .filter((element) => element.checkVisibility())
        .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80))
        .join('|');
    return [
      location.pathname,
      text('h1, h2'),
      text('dialog[open], [role="dialog"], [aria-modal="true"]'),
      text('[role="alert"], [role="status"]'),
    ].join('#');
  });
  return createHash('sha1').update(signature).digest('hex').slice(0, 12);
}

/** Scans each new page state once while the persona moves through the app. Never counts towards the persona's waits. */
export async function rideAlong(session: Session): Promise<A11yScan | null> {
  const config = session.config.inspectors.a11y;
  if (!config.enabled || config.mode === 'sweep' || session.page.isClosed()) {
    return null;
  }

  return auditState(session, false);
}

export async function auditState(session: Session, force: boolean): Promise<A11yScan | null> {
  const config = session.config.inspectors.a11y;
  await session.page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
  const state = await stateKey(session.page).catch(() => null);
  if (state === null || (!force && session.seenStates.has(state))) {
    return null;
  }
  session.seenStates.add(state);

  const violations = await scan(session.page, config).catch((error: unknown) => {
    session.writer.log(
      session,
      `a11y scan failed: ${(error as Error).message.split('\n')[0] ?? ''}`,
    );
    return null;
  });
  if (violations === null) {
    return null;
  }

  const screenshot =
    violations.length > 0
      ? await session.writer.screenshot(session, `a11y-${session.a11yScans.length + 1}`)
      : undefined;
  const outline = await pageOutline(session.page, session.snapshot).catch(() => '');
  const result: A11yScan = {
    step: session.steps,
    url: session.page.url(),
    state,
    outline,
    ...(screenshot === undefined ? {} : { screenshot }),
    violations,
  };
  session.a11yScans.push(result);
  session.writer.log(
    session,
    `a11y ${violations.length} violation${violations.length === 1 ? '' : 's'} at ${new URL(result.url).pathname}`,
  );
  return result;
}

export function formatScan(result: A11yScan | null): string {
  if (result === null) return 'The accessibility scan could not run on this page.';
  if (result.violations.length === 0)
    return `No automated WCAG violations on ${result.url}. Automated checks cover only part of WCAG.`;

  return [
    `${result.violations.length} automated WCAG violation${result.violations.length === 1 ? '' : 's'} on ${result.url}:`,
    ...result.violations.map(
      (violation) =>
        `- ${violation.rule} (${violation.impact}, WCAG ${violation.wcag.join(', ') || 'best practice'}): ${violation.help}. ${violation.nodes.length} element${violation.nodes.length === 1 ? '' : 's'}, e.g. ${violation.nodes[0]?.target ?? ''}`,
    ),
  ].join('\n');
}
