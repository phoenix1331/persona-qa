import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Session } from './sessions.js';

export interface Issue {
  id: string;
  step: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  what_happened: string;
  expected: string;
  url: string;
  screenshot?: string;
  recorded_at: string;
}

export function newRunId(now = new Date()): string {
  return now.toISOString().slice(0, 16).replace(':', '-');
}

export function runDirFor(
  projectDir: string,
  outputDir: string,
  runId: string,
  sessionKey: string,
): string {
  const base = isAbsolute(outputDir) ? outputDir : resolve(projectDir, outputDir);
  return join(base, runId, sessionKey);
}

/** Owns everything a session writes to disk. Created at start, completed by finish. */
export class RunWriter {
  readonly screenshotsDir: string;
  private screenshotCount = 0;

  constructor(
    readonly dir: string,
    private readonly projectDir: string,
  ) {
    this.screenshotsDir = join(dir, 'screenshots');
    mkdirSync(this.screenshotsDir, { recursive: true });
    writeFileSync(join(dir, 'actions.log'), '');
  }

  async startTrace(session: Session): Promise<void> {
    if (session.config.output.trace === 'off') {
      return;
    }
    await session.context.tracing.start({ screenshots: true, snapshots: true, title: session.id });
  }

  log(session: Session, entry: string): void {
    const elapsed = ((Date.now() - session.startedAt) / 1000).toFixed(1).padStart(6);
    appendFileSync(
      join(this.dir, 'actions.log'),
      `+${elapsed}s  step ${String(session.steps).padStart(3)}  ${entry}\n`,
    );
  }

  /** Saves a screenshot and returns its path relative to the run folder. */
  async screenshot(session: Session, label: string): Promise<string | undefined> {
    if (session.config.output.screenshots === 'off') {
      return undefined;
    }

    this.screenshotCount += 1;
    const name = `${String(this.screenshotCount).padStart(3, '0')}-${label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.jpg`;
    const path = join(this.screenshotsDir, name);
    const saved = await session.page
      .screenshot({ path, type: 'jpeg', quality: 70 })
      .then(() => true)
      .catch(() => false);

    return saved ? `screenshots/${name}` : undefined;
  }

  async afterAction(session: Session, label: string): Promise<void> {
    if (session.config.output.screenshots === 'every_action') {
      await this.screenshot(session, `step-${session.steps}-${label}`);
    }
  }

  /** Writes journal, issues, run facts and (per config) the trace. Returns paths relative to the project. */
  async complete(session: Session): Promise<string[]> {
    await this.screenshot(session, 'final');

    const trace = session.config.output.trace;
    const keepTrace =
      trace === 'always' || (trace === 'on_failure' && session.outcome !== 'success');
    if (trace !== 'off') {
      await session.context.tracing
        .stop(keepTrace ? { path: join(this.dir, 'trace.zip') } : {})
        .catch(() => undefined);
    }

    writeFileSync(join(this.dir, 'journal.md'), journalMarkdown(session));
    writeFileSync(
      join(this.dir, 'issues.json'),
      `${JSON.stringify({ session: session.id, persona: session.persona.id, mission: session.mission.id, issues: session.issues }, null, 2)}\n`,
    );
    writeFileSync(join(this.dir, 'run.json'), `${JSON.stringify(runFacts(session), null, 2)}\n`);

    const files = ['journal.md', 'issues.json', 'run.json', 'actions.log', 'screenshots/'];
    if (keepTrace) files.push('trace.zip');
    return files.map((file) => relative(this.projectDir, join(this.dir, file)));
  }
}

function runFacts(session: Session): Record<string, unknown> {
  return {
    session: session.id,
    persona: session.persona.id,
    persona_sources: session.persona.sources,
    mission: session.mission.id,
    outcome: session.outcome ?? 'incomplete',
    end_reason: session.endReason ?? 'finished by persona',
    steps: session.steps,
    duration_seconds: Math.round((Date.now() - session.startedAt) / 1000),
    longest_wait_seconds: Number((session.longestWaitMs / 1000).toFixed(1)),
    patience_breaches: session.patienceBreaches,
    environment: session.environment.description,
    base_url: session.baseUrl,
    final_url: session.page.isClosed() ? null : session.page.url(),
    issue_count: session.issues.length,
    blocked_requests: session.blockedRequests,
    started_at: new Date(session.startedAt).toISOString(),
  };
}

function journalMarkdown(session: Session): string {
  const { persona, mission } = session;
  return [
    `# ${persona.name} - ${mission.id}`,
    '',
    `| | |`,
    `|-|-|`,
    `| Persona | ${persona.name}${persona.age === undefined ? '' : `, ${persona.age}`} (\`${persona.id}\`) |`,
    `| Device | ${session.environment.description} |`,
    `| Mission | ${mission.goal.trim()} |`,
    `| Outcome | **${session.outcome ?? 'incomplete'}** (${session.endReason ?? 'finished by persona'}) |`,
    `| Steps | ${session.steps} |`,
    `| Longest wait | ${(session.longestWaitMs / 1000).toFixed(1)}s |`,
    `| Issues recorded | ${session.issues.length} |`,
    '',
    '## Journal',
    '',
    (session.journal ?? '').trim(),
    '',
  ].join('\n');
}
