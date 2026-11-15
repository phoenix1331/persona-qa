import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Page {
  body: string;
  status?: number;
  delayMs?: number;
  type?: string;
}

export interface TestSite {
  url: string;
  host: string;
  pages: Map<string, Page>;
  hits: string[];
  close: () => Promise<void>;
}

export function html(title: string, body: string): Page {
  return {
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`,
  };
}

export async function startSite(pages: Record<string, Page> = {}): Promise<TestSite> {
  const map = new Map(Object.entries(pages));
  const hits: string[] = [];

  const server: Server = createServer((request, response) => {
    const path = request.url ?? '/';
    hits.push(path);
    const page = map.get(path.split('?')[0] ?? '/') ?? { status: 404, body: 'Not found' };

    setTimeout(() => {
      response.writeHead(page.status ?? 200, {
        'content-type': page.type ?? 'text/html; charset=utf-8',
      });
      response.end(page.body);
    }, page.delayMs ?? 0);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    pages: map,
    hits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
