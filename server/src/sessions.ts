import { randomBytes } from 'node:crypto';
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  chromium,
} from 'playwright';
import { Activity } from './activity.js';
import { isAllowedUrl } from './domain-guard.js';
import {
  type ResolvedEnvironment,
  applyNetwork,
  applyTextZoom,
  resolveEnvironment,
} from './environment.js';
import { PersonaQAError } from './errors.js';
import type { Loader } from './loader.js';
import type { SnapshotState } from './snapshot.js';
import type { Config, Mission, Persona } from './types.js';
import { seededRandom } from './typos.js';
import { type Issue, RunWriter, newRunId, runDirFor } from './writer.js';

export type Outcome = 'success' | 'abandoned' | 'limit' | 'incomplete';

export interface Session {
  id: string;
  persona: Persona;
  mission: Mission;
  config: Config;
  baseUrl: string;
  context: BrowserContext;
  page: Page;
  startedAt: number;
  steps: number;
  status: 'active' | 'ended';
  outcome?: Outcome;
  endReason?: string;
  journal?: string;
  /** Messages for the persona, delivered and cleared by the next tool response. */
  notices: string[];
  blockedRequests: string[];
  snapshot: SnapshotState;
  activity: Activity;
  touch: boolean;
  environment: ResolvedEnvironment;
  cdp: CDPSession;
  random: () => number;
  lastActionMs: number;
  patienceBreaches: number;
  /** Longest single wait in the run, for the report. */
  longestWaitMs: number;
  runId: string;
  writer: RunWriter;
  issues: Issue[];
}

export interface StartOptions {
  baseUrl?: string;
  /** Groups parallel sessions into one run folder. */
  runId?: string;
}

export interface SessionManagerOptions {
  loader: () => Loader;
  projectDir: string;
  headless?: boolean;
}

export class SessionManager {
  private browser: Browser | undefined;
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly options: SessionManagerOptions) {}

  async start(personaId: string, missionId: string, options: StartOptions = {}): Promise<Session> {
    const loader = this.options.loader();
    const config = loader.config();
    const persona = loader.persona(personaId);
    const mission = loader.mission(missionId);
    const baseUrl = options.baseUrl ?? config.app.base_url;
    const allowed = this.allowedDomains(config, baseUrl, options.baseUrl !== undefined);
    const startUrl = new URL(mission.start_url, baseUrl).toString();

    if (!isAllowedUrl(startUrl, allowed)) {
      throw new PersonaQAError(
        `Mission start URL ${startUrl} is outside app.allowed_domains (${allowed.join(', ')})`,
      );
    }

    const environment = resolveEnvironment(persona.environment);
    const browser = await this.ensureBrowser();
    const context = await browser.newContext(environment.contextOptions);
    await applyTextZoom(context, environment.textZoom);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await applyNetwork(cdp, environment.network);

    const id = `${persona.id}--${mission.id}--${randomBytes(2).toString('hex')}`;
    const runId = options.runId ?? newRunId();
    const writer = new RunWriter(
      runDirFor(this.options.projectDir, config.output.dir, runId, `${persona.id}--${mission.id}`),
      this.options.projectDir,
    );
    const session: Session = {
      id,
      persona,
      mission,
      config: { ...config, app: { ...config.app, allowed_domains: allowed } },
      baseUrl,
      context,
      page,
      startedAt: Date.now(),
      steps: 0,
      status: 'active',
      notices: [],
      blockedRequests: [],
      snapshot: { nextRef: 1 },
      activity: new Activity(page),
      touch: environment.input === 'touch',
      environment,
      cdp,
      random: seededRandom(id),
      lastActionMs: 0,
      patienceBreaches: 0,
      longestWaitMs: 0,
      runId,
      writer,
      issues: [],
    };

    await this.guard(session);
    await writer.startTrace(session);
    this.sessions.set(session.id, session);

    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      session.notices.push(
        `The first page did not load: ${(error as Error).message.split('\n')[0]}`,
      );
    }
    writer.log(
      session,
      `start ${persona.id} x ${mission.id} at ${startUrl} (${environment.description})`,
    );

    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new PersonaQAError(`No session "${id}". Call start_session first.`);
    }

    return session;
  }

  active(id: string): Session {
    const session = this.get(id);
    if (session.status === 'ended') {
      throw new PersonaQAError(
        `Session "${id}" has ended (${session.outcome ?? 'incomplete'}: ${session.endReason ?? 'finished'}). Call finish to write your journal.`,
      );
    }

    return session;
  }

  /** Stops the session; tools other than finish refuse it afterwards. The browser stays open for evidence until close(). */
  end(session: Session, outcome: Outcome, reason: string): void {
    if (session.status === 'ended') {
      return;
    }

    session.status = 'ended';
    session.outcome = outcome;
    session.endReason = reason;
  }

  async close(session: Session): Promise<void> {
    await session.context.close().catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.end(session, session.outcome ?? 'incomplete', 'server shut down');
      await this.close(session);
    }
    await this.browser?.close();
    this.browser = undefined;
  }

  private allowedDomains(config: Config, baseUrl: string, overridden: boolean): string[] {
    if (!overridden) {
      return config.app.allowed_domains;
    }

    return [...new Set([...config.app.allowed_domains, new URL(baseUrl).host])];
  }

  private async guard(session: Session): Promise<void> {
    const allowed = session.config.app.allowed_domains;

    await session.context.route('**/*', async (route) => {
      const request = route.request();
      if (isAllowedUrl(request.url(), allowed)) {
        await route.continue();
        return;
      }

      session.blockedRequests.push(request.url());
      if (request.isNavigationRequest() && request.frame() === session.page.mainFrame()) {
        session.notices.push(
          `The browser refused to open ${new URL(request.url()).host}: it is outside the site being tested.`,
        );
        // 204 keeps the current document, so the persona stays where they were
        await route.fulfill({ status: 204 });
        return;
      }

      await route.abort('blockedbyclient');
    });
  }

  private async ensureBrowser(): Promise<Browser> {
    this.browser ??= await chromium.launch({ headless: this.options.headless ?? true });
    return this.browser;
  }
}
