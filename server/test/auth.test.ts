import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Project, connect, makeProject, sessionIdFrom } from './support/harness.js';
import { type TestSite, html, startSite } from './support/site.js';

let site: TestSite;
let harness: Awaited<ReturnType<typeof connect>>;
let project: Project;

const loginMission =
  'id: login\ngoal: Sign in with your account.\nstart_url: /login\nsuccess:\n  any:\n    - text_visible: Welcome back\n';
const membersMission =
  'id: members\ngoal: Open the members area.\nstart_url: /members\naccount: fan\nsuccess:\n  any:\n    - text_visible: Members area\n';

beforeAll(async () => {
  site = await startSite({
    '/login': html(
      'Sign in',
      `<form id="f"><label for="e">Email</label><input id="e"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>
       <script>document.getElementById('f').addEventListener('submit', (event) => {
         event.preventDefault();
         if (document.getElementById('e').value === 'fan@example.com' && document.getElementById('p').value === 'secret') {
           document.cookie = 'sid=ok; path=/; max-age=3600';
           location.href = '/welcome';
         }
       });</script>`,
    ),
    '/welcome': html('Welcome', '<h1>Welcome back</h1>'),
    '/members': html(
      'Members',
      `<h1 id="m"></h1><script>document.getElementById('m').textContent = document.cookie.includes('sid=ok') ? 'Members area' : 'Please sign in';</script>`,
    ),
  });
});

afterAll(async () => {
  await site.close();
});

afterEach(async () => {
  await harness?.close();
});

async function setup(auth: string) {
  project = makeProject(site.url, [site.host], loginMission.replace('id: login', 'id: checkout'));
  project.write('.personaqa/missions/members.yaml', membersMission);
  project.write('.personaqa/missions/login.yaml', loginMission);
  const config = readFileSync(join(project.dir, '.personaqa/config.yaml'), 'utf8');
  project.write(
    '.personaqa/config.yaml',
    `${config}auth:\n${auth}  accounts:\n    fan: { email: fan@example.com, password: secret }\n`,
  );
  harness = await connect(project);
}

async function signIn(id: string) {
  const screen = (await harness.call('look', { session: id })).text;
  const ref = (pattern: string) =>
    new RegExp(`\\[(e\\d+) ${pattern}`).exec(screen)?.[1] ?? 'missing';
  await harness.call('type', { session: id, ref: ref('textbox "Email"'), text: 'fan@example.com' });
  await harness.call('type', { session: id, ref: ref('textbox "Password"'), text: 'secret' });
  return harness.call('tap', { session: id, ref: ref('button "Sign in"') });
}

describe('saved logins (storage_state)', () => {
  it('explains how to create a missing saved login', async () => {
    await setup('  strategy: storage_state\n  storage_state: .personaqa/auth/fan.json\n');

    const result = await harness.call('start_session', { persona: 'james', mission: 'members' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      'No saved login at .personaqa/auth/fan.json. Create it with /personaqa:auth fan',
    );
    expect(result.text).toContain('npx playwright codegen --save-storage=.personaqa/auth/fan.json');
  });

  it('saves a login with the sign-in helper, then loads it into later sessions', async () => {
    await setup('  strategy: storage_state\n  storage_state: .personaqa/auth/fan.json\n');
    project.write(
      '.personaqa/missions/login.yaml',
      loginMission.replace('success:', 'account: fan\nsuccess:'),
    );

    const started = await harness.call('start_session', {
      persona: 'signin',
      mission: 'login',
      save_login: true,
    });
    const id = sessionIdFrom(started.text);
    expect(started.text).toContain('## You are Sign-in helper');
    expect(started.text).toContain('- your email: fan@example.com');

    const done = await signIn(id);
    expect(done.text).toContain('Mission complete');
    expect(done.text).toContain('The login has been saved.');
    const saved = join(project.dir, '.personaqa/auth/fan.json');
    expect(existsSync(saved)).toBe(true);
    expect(readFileSync(saved, 'utf8')).toContain('"sid"');

    const member = await harness.call('start_session', { persona: 'james', mission: 'members' });
    const memberId = sessionIdFrom(member.text);
    expect(member.text).toContain('Mission complete ("Members area" is visible)');
    expect(harness.sessions.get(memberId).outcome).toBe('success');
  });
});

describe('sign-in missions (login_mission)', () => {
  it('has the persona sign in first, then moves them to the mission', async () => {
    await setup('  strategy: login_mission\n  login_mission: login\n');

    const started = await harness.call('start_session', { persona: 'james', mission: 'members' });
    const id = sessionIdFrom(started.text);
    expect(started.text).toContain('First you need to sign in: Sign in with your account.');
    expect(started.text).toContain('- your password: secret');
    expect(harness.sessions.get(id).page.url()).toBe(`${site.url}/login`);

    const signedIn = await signIn(id);

    expect(signedIn.text).toContain(
      'You are signed in. The browser has moved on to the start of your mission: Open the members area.',
    );
    expect(signedIn.text).toContain('Mission complete ("Members area" is visible)');
    expect(harness.sessions.get(id).page.url()).toBe(`${site.url}/members`);
    expect(harness.sessions.get(id).outcome).toBe('success');
  });

  it('rejects a mission that names an unknown account', async () => {
    await setup('  strategy: none\n');
    project.write(
      '.personaqa/missions/members.yaml',
      membersMission.replace('account: fan', 'account: admin'),
    );

    const result = await harness.call('start_session', { persona: 'james', mission: 'members' });

    expect(result.text).toContain('uses account "admin", which is not in auth.accounts (fan)');
  });
});
