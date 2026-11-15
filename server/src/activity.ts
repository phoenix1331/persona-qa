import type { Page, Request } from 'playwright';

const IGNORED_TYPES = new Set(['websocket', 'eventsource', 'manifest', 'other']);

/** Tracks network activity so an action can wait until the page has settled, like a person watching it load. */
export class Activity {
  private inflight = new Set<Request>();
  private lastChange = Date.now();

  constructor(page: Page) {
    page.on('request', (request) => {
      if (IGNORED_TYPES.has(request.resourceType())) return;
      this.inflight.add(request);
      this.lastChange = Date.now();
    });
    const done = (request: Request): void => {
      if (this.inflight.delete(request)) this.lastChange = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  /** Starts the quiet window now, so a navigation that begins just after an action is waited for. */
  mark(): void {
    this.lastChange = Date.now();
  }

  /** Resolves once nothing has loaded for `quietMs`, or after `maxMs`. Returns true if it settled. */
  async settle(quietMs = 300, maxMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastChange >= quietMs) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }
}
