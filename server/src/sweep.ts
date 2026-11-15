import { auditState } from './audit.js';
import { isAllowedUrl } from './domain-guard.js';
import type { Session, SessionManager } from './sessions.js';
import type { Persona } from './types.js';
import { newRunId } from './writer.js';

export const SWEEP_PERSONA: Persona = {
  id: 'sweep',
  name: 'Accessibility sweep',
  bio: 'No persona: an automated pass over the mission pages.',
  environment: { preset: 'desktop-fast' },
  traits: { patience_seconds: 60, reading: 'reads', tech_confidence: 'high' },
  sources: [],
};

const SKIP = /(logout|log-out|sign-?out|delete|unsubscribe)/i;

export interface SweepResult {
  run_id: string;
  folder: string;
  pages: { mission: string; scanned: number; violations: number }[];
}

/** Collects same-site links on the page, one per path, excluding anything that looks destructive. */
async function links(session: Session): Promise<string[]> {
  const hrefs = await session.page.$$eval('a[href]', (anchors) =>
    anchors
      .map((anchor) => (anchor as HTMLAnchorElement).href)
      .filter((href) => href.startsWith('http')),
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const href of hrefs) {
    const url = new URL(href);
    url.hash = '';
    if (
      !isAllowedUrl(url.toString(), session.config.app.allowed_domains) ||
      SKIP.test(url.pathname)
    )
      continue;
    if (seen.has(url.pathname)) continue;
    seen.add(url.pathname);
    result.push(url.toString());
  }
  return result;
}

/** Scans each mission's start page and the same-site pages it links to, with no persona. */
export async function sweep(
  sessions: SessionManager,
  input: { missions?: string[]; base_url?: string; run_id?: string; max_pages?: number },
): Promise<SweepResult> {
  const loader = sessions.loader();
  const config = loader.config();
  const missionIds = loader.select('missions', input.missions ?? 'all');
  const runId = input.run_id ?? newRunId();
  const maxPages = input.max_pages ?? 15;
  const pages: SweepResult['pages'] = [];
  let folder = '';

  for (const missionId of missionIds) {
    const session = await sessions.startWith(config, SWEEP_PERSONA, loader.mission(missionId), {
      runId,
      ...(input.base_url === undefined ? {} : { baseUrl: input.base_url }),
    });
    folder = session.writer.dir.replace(/\/[^/]+$/, '');
    const visited = new Set([new URL(session.page.url()).pathname]);
    await auditState(session, true);

    for (const url of (await links(session))
      .filter((link) => !visited.has(new URL(link).pathname))
      .slice(0, maxPages - 1)) {
      visited.add(new URL(url).pathname);
      await session.page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        .catch(() => undefined);
      await auditState(session, false);
    }

    pages.push({
      mission: missionId,
      scanned: session.a11yScans.length,
      violations: session.a11yScans.reduce((sum, scan) => sum + scan.violations.length, 0),
    });
    session.journal = `Automated accessibility sweep of ${session.a11yScans.length} page states from the "${missionId}" start page. No persona was involved.`;
    sessions.end(session, 'incomplete', 'accessibility sweep');
    await session.writer.complete(session);
    await sessions.close(session);
  }

  return { run_id: runId, folder, pages };
}
