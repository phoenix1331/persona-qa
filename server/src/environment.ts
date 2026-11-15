import type { BrowserContext, BrowserContextOptions, CDPSession, Page } from 'playwright';
import { PersonaQAError } from './errors.js';
import { playwright } from './playwright.js';
import type { InputMethod, NetworkProfile, PersonaEnvironment, PresetName } from './types.js';

interface Preset {
  device?: string;
  viewport?: { width: number; height: number };
  input: InputMethod;
  network: NetworkProfile;
  text_zoom?: number;
  reduced_motion?: boolean;
  forced_colours?: boolean;
  summary: string;
}

export const PRESETS: Record<PresetName, Preset> = {
  'mobile-3g': {
    device: 'iPhone 15',
    input: 'touch',
    network: 'slow-3g',
    summary: 'phone, touch screen, slow 3G',
  },
  'mobile-4g': {
    device: 'iPhone 15',
    input: 'touch',
    network: '4g',
    summary: 'phone, touch screen, 4G',
  },
  'ipad-large-text': {
    device: 'iPad (gen 7)',
    input: 'touch',
    network: 'wifi',
    text_zoom: 1.5,
    summary: 'tablet, touch screen, text enlarged to 150%',
  },
  'desktop-keyboard-only': {
    viewport: { width: 1280, height: 800 },
    input: 'keyboard_only',
    network: 'wifi',
    summary: 'desktop, keyboard only (no mouse)',
  },
  'desktop-reduced-motion': {
    viewport: { width: 1280, height: 800 },
    input: 'mouse',
    network: 'wifi',
    reduced_motion: true,
    forced_colours: true,
    summary: 'desktop, reduced motion and high contrast mode',
  },
  'desktop-fast': {
    viewport: { width: 1280, height: 800 },
    input: 'mouse',
    network: 'wifi',
    summary: 'desktop, mouse, fast connection',
  },
};

/** Chrome DevTools throttling profiles (bytes per second, milliseconds). */
export const NETWORKS: Record<
  NetworkProfile,
  { offline: boolean; latency: number; download: number; upload: number }
> = {
  'slow-3g': { offline: false, latency: 2000, download: 50_000, upload: 50_000 },
  'fast-3g': { offline: false, latency: 563, download: 180_000, upload: 84_375 },
  '4g': { offline: false, latency: 85, download: 1_125_000, upload: 375_000 },
  wifi: { offline: false, latency: 0, download: -1, upload: -1 },
  none: { offline: true, latency: 0, download: -1, upload: -1 },
};

export interface ResolvedEnvironment {
  contextOptions: BrowserContextOptions;
  input: InputMethod;
  network: NetworkProfile;
  textZoom: number;
  /** One line for the persona brief, e.g. "iPhone 15, touch screen, slow 3G". */
  description: string;
}

export function resolveEnvironment(environment: PersonaEnvironment): ResolvedEnvironment {
  const preset = PRESETS[environment.preset];
  const deviceName = environment.device ?? preset.device;
  const device = deviceName === undefined ? undefined : playwright().devices[deviceName];

  if (deviceName !== undefined && device === undefined) {
    throw new PersonaQAError(
      `Unknown device "${deviceName}". Use a Playwright device name such as "iPhone 15" or "Pixel 7".`,
    );
  }

  const input = environment.input ?? preset.input;
  const network = environment.network ?? preset.network;
  const textZoom = environment.text_zoom ?? preset.text_zoom ?? 1;
  const { defaultBrowserType: _browser, ...deviceOptions } = device ?? {
    defaultBrowserType: 'chromium',
  };

  const reducedMotion = environment.reduced_motion ?? preset.reduced_motion ?? false;
  const forcedColours = environment.forced_colours ?? preset.forced_colours ?? false;
  const viewport = environment.viewport ?? device?.viewport ?? preset.viewport;

  const contextOptions: BrowserContextOptions = {
    ...deviceOptions,
    ...(viewport === undefined ? {} : { viewport }),
    hasTouch: input === 'touch',
    isMobile: device?.isMobile ?? false,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    forcedColors: forcedColours ? 'active' : 'none',
    locale: environment.locale ?? 'en-GB',
    timezoneId: environment.timezone ?? 'Europe/London',
  };

  const parts = [
    deviceName ?? preset.summary.split(',')[0],
    input === 'touch'
      ? 'touch screen'
      : input === 'keyboard_only'
        ? 'keyboard only (no mouse)'
        : 'mouse',
    network === 'wifi'
      ? 'fast connection'
      : network === 'none'
        ? 'no connection'
        : `${network.replace('-', ' ')} connection`,
  ];
  if (textZoom !== 1) parts.push(`text enlarged to ${Math.round(textZoom * 100)}%`);
  if (reducedMotion) parts.push('reduced motion');
  if (forcedColours) parts.push('high contrast mode');

  return { contextOptions, input, network, textZoom, description: parts.join(', ') };
}

export async function applyNetwork(cdp: CDPSession, profile: NetworkProfile): Promise<void> {
  const settings = NETWORKS[profile];
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: settings.offline,
    latency: settings.latency,
    downloadThroughput: settings.download,
    uploadThroughput: settings.upload,
  });
}

/** Mimics the browser text-size setting: scales the root font size so relative units grow and fixed px text does not. */
export async function applyTextZoom(context: BrowserContext, zoom: number): Promise<void> {
  if (zoom === 1) {
    return;
  }

  await context.addInitScript((scale: number) => {
    const style = document.createElement('style');
    style.dataset['personaqa'] = 'text-zoom';
    style.textContent = `html { font-size: ${scale * 100}% !important; }`;
    const attach = (): void => {
      document.head.append(style);
    };
    if (document.head === null) {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
      return;
    }
    attach();
  }, zoom);
}

export async function openCdp(context: BrowserContext, page: Page): Promise<CDPSession> {
  return context.newCDPSession(page);
}
