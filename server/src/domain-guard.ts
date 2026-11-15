const ALWAYS_ALLOWED_PROTOCOLS = new Set(['about:', 'data:', 'blob:']);

/**
 * Entries are `host`, `host:port` or `*.domain`. An entry without a port matches any port on that host.
 */
export function isAllowedUrl(url: string, allowedDomains: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (ALWAYS_ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return allowedDomains.some((entry) => matches(parsed, entry.toLowerCase()));
}

function matches(url: URL, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(1);
    return url.hostname.endsWith(suffix) || url.hostname === entry.slice(2);
  }

  if (entry.includes(':')) {
    return url.host === entry;
  }

  return url.hostname === entry;
}
