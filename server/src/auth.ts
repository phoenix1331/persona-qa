import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { PersonaQAError } from './errors.js';
import type { Loader } from './loader.js';
import type { Session } from './sessions.js';
import type { Config, Mission, Persona } from './types.js';

export interface SessionAuth {
  /** Key in config auth.accounts, when the run uses one. */
  account?: string;
  credentials?: { email: string; password: string };
  /** Saved login to load into the browser before the persona starts. */
  storageState?: string;
  /** Sign-in mission the persona completes first, under the login_mission strategy. */
  loginMission?: Mission;
  phase: 'login' | 'mission';
  /** Where to save the browser's login once the mission succeeds (/personaqa:auth). */
  saveTo?: string;
}

/** Patient, neutral persona used by /personaqa:auth to sign in and save the login. Never listed or run as a persona. */
export const SIGNIN_PERSONA: Persona = {
  id: 'signin',
  name: 'Sign-in helper',
  bio: 'Signs in with the account details given, carefully and without fuss, so the login can be saved for persona runs.',
  environment: { preset: 'desktop-fast' },
  traits: { patience_seconds: 60, reading: 'reads', tech_confidence: 'high' },
  voice: 'Brief and factual.',
  sources: [],
};

const absolute = (projectDir: string, path: string): string =>
  isAbsolute(path) ? path : resolve(projectDir, path);

export function planAuth(
  config: Config,
  mission: Mission,
  loader: Loader | undefined,
  projectDir: string,
  options: { saveLogin?: boolean } = {},
): SessionAuth {
  const strategy = config.auth.strategy;
  const accounts = config.auth.accounts;
  const key =
    mission.account ?? (strategy !== 'none' || options.saveLogin === true ? 'default' : undefined);
  const account = key === undefined ? undefined : accounts[key];

  if (mission.account !== undefined && account === undefined) {
    throw new PersonaQAError(
      `Mission "${mission.id}" uses account "${mission.account}", which is not in auth.accounts (${Object.keys(accounts).join(', ') || 'none defined'}).`,
    );
  }

  const auth: SessionAuth = {
    ...(key === undefined || account === undefined
      ? {}
      : { account: key, credentials: { email: account.email, password: account.password } }),
    phase: 'mission',
  };

  if (options.saveLogin === true) {
    const target =
      account?.storage_state ??
      config.auth.storage_state ??
      `.personaqa/auth/${key ?? 'default'}.json`;
    return { ...auth, saveTo: absolute(projectDir, target) };
  }

  if (strategy === 'storage_state') {
    const path = account?.storage_state ?? config.auth.storage_state;
    if (path === undefined) {
      throw new PersonaQAError('auth.strategy is storage_state but no storage_state path is set.');
    }
    const file = absolute(projectDir, path);
    if (!existsSync(file)) {
      throw new PersonaQAError(
        `No saved login at ${path}. Create it with /personaqa:auth${key === undefined ? '' : ` ${key}`}, or by hand with: npx playwright codegen --save-storage=${path} ${config.app.base_url}`,
      );
    }
    return { ...auth, storageState: file };
  }

  if (
    strategy === 'login_mission' &&
    config.auth.login_mission !== undefined &&
    config.auth.login_mission !== mission.id
  ) {
    if (loader === undefined) {
      throw new PersonaQAError('A login mission needs the project loader.');
    }
    return { ...auth, loginMission: loader.mission(config.auth.login_mission), phase: 'login' };
  }

  return auth;
}

/** Saves the browser's cookies and storage as a Playwright storage state file. */
export async function saveLogin(session: Session): Promise<string | null> {
  const target = session.auth.saveTo;
  if (target === undefined) return null;
  mkdirSync(dirname(target), { recursive: true });
  await session.context.storageState({ path: target });
  return target;
}
