export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Level = 'low' | 'medium' | 'high';
export type Selection = 'all' | string[];

export type PresetName =
  | 'mobile-3g'
  | 'mobile-4g'
  | 'ipad-large-text'
  | 'desktop-keyboard-only'
  | 'desktop-reduced-motion'
  | 'desktop-fast';

export type NetworkProfile = 'slow-3g' | 'fast-3g' | '4g' | 'wifi' | 'none';
export type InputMethod = 'touch' | 'mouse' | 'keyboard_only';

export interface Config {
  version: 1;
  app: { name: string; base_url: string; allowed_domains: string[] };
  auth: {
    strategy: 'none' | 'storage_state' | 'login_mission';
    storage_state?: string;
    login_mission?: string;
    accounts: Record<string, { email: string; password: string }>;
  };
  runner: {
    max_parallel: number;
    max_steps_per_run: number;
    max_minutes_per_run: number;
    model?: string;
  };
  personas: { enabled: Selection; paths: string[] };
  missions: { paths: string[] };
  output: {
    dir: string;
    screenshots: 'every_action' | 'on_issue' | 'off';
    trace: 'always' | 'on_failure' | 'off';
    regression_tests: 'off' | 'suggest' | 'write';
  };
  issues: { sink: 'file' | 'github'; github: { labels: string[]; min_severity: Severity } };
  ci: Record<string, { personas: Selection; missions: Selection }>;
  inspectors: {
    a11y: {
      enabled: boolean;
      standard: 'wcag21' | 'wcag22';
      level: 'A' | 'AA' | 'AAA';
      mode: 'ride_along' | 'sweep' | 'both';
      ignore: string[];
    };
    ux: { enabled: boolean; heuristics: 'nielsen' };
  };
}

export interface PersonaEnvironment {
  preset: PresetName;
  device?: string;
  viewport?: { width: number; height: number };
  input?: InputMethod;
  network?: NetworkProfile;
  text_zoom?: number;
  reduced_motion?: boolean;
  forced_colours?: boolean;
  locale?: string;
  timezone?: string;
  events?: {
    offline?: { chance: number; duration_seconds: [number, number] };
    session_expiry?: { chance: number; after_steps?: [number, number] };
  };
}

export interface PersonaTraits {
  patience_seconds: number;
  reading: 'skims' | 'reads' | 'scrutinises';
  tech_confidence: Level;
  typo_rate?: 'none' | 'low' | 'medium' | 'high';
  trust_in_payments?: Level;
  back_button?: 'never' | 'sometimes' | 'often';
  language_confidence?: Level;
}

export interface Persona {
  id: string;
  name: string;
  age?: number;
  bio: string;
  environment: PersonaEnvironment;
  traits: PersonaTraits;
  voice?: string;
  /** Files the persona was assembled from, most specific first. */
  sources: string[];
}

export type SuccessRule =
  | { url_contains: string }
  | { url_matches: string }
  | { text_visible: string }
  | { element_visible: string };

export interface Mission {
  id: string;
  goal: string;
  start_url: string;
  time_limit_minutes?: number;
  max_steps?: number;
  account?: string;
  success: { any: SuccessRule[] } | { all: SuccessRule[] };
  data?: Record<string, string | number | boolean>;
  context?: string;
}
