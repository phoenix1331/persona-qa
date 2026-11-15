#!/usr/bin/env node
// Renders summary.md, report.html and report.json (the same data, for other skills) for one run folder.
// Usage: node scripts/report.mjs <run-dir>
// Reads each session's run.json, issues.json and journal.md, plus optional findings.json (written by the
// coordinator), usage.json (written by the run skill), a11y.json and ux.json. Ranking and cost are computed here,
// deterministically; merging duplicate issues is the coordinator's judgement.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keyFor, loadTriage } from './triage.mjs';

const SEVERITY_WEIGHT = { critical: 8, high: 5, medium: 3, low: 1 };

const readJson = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`warning: could not read ${path}: ${error.message}`);
    return fallback;
  }
};

export function loadRun(runDir) {
  const sessions = readdirSync(runDir)
    .filter((name) => statSync(join(runDir, name)).isDirectory() && existsSync(join(runDir, name, 'run.json')))
    .sort()
    .map((dir) => {
      const facts = readJson(join(runDir, dir, 'run.json'), {});
      const issues = readJson(join(runDir, dir, 'issues.json'), { issues: [] }).issues ?? [];
      const journalFile = join(runDir, dir, 'journal.md');
      const journal = existsSync(journalFile)
        ? readFileSync(journalFile, 'utf8').split('## Journal').slice(1).join('## Journal').trim()
        : '';
      const shotsDir = join(runDir, dir, 'screenshots');
      const screenshots = existsSync(shotsDir) ? readdirSync(shotsDir).sort().map((name) => `screenshots/${name}`) : [];
      return { dir, facts, issues, journal, screenshots, trace: existsSync(join(runDir, dir, 'trace.zip')) };
    });

  return {
    sessions,
    findings: readJson(join(runDir, 'findings.json'), null),
    usage: readJson(join(runDir, 'usage.json'), []),
    a11y: readJson(join(runDir, 'a11y.json'), null),
    ux: readJson(join(runDir, 'ux.json'), null),
  };
}

function issueIndex(sessions) {
  const index = new Map();
  for (const session of sessions) {
    for (const issue of session.issues) index.set(issue.id, { ...issue, session: session.dir });
  }
  return index;
}

/** Without a coordinator, every recorded issue stands alone. */
function fallbackFindings(sessions) {
  return sessions.flatMap((session) =>
    session.issues.map((issue) => ({
      title: issue.title,
      severity: issue.severity,
      category: 'ux',
      summary: issue.what_happened,
      personas: [session.facts.persona],
      evidence: [issue.id],
    })),
  );
}

export function rankFindings(rawFindings, sessions) {
  const index = issueIndex(sessions);
  const failedPersonas = new Set(sessions.filter((session) => session.facts.outcome !== 'success').map((session) => session.facts.persona));

  const findings = rawFindings
    .filter((finding) => SEVERITY_WEIGHT[finding.severity] !== undefined && typeof finding.title === 'string')
    .map((finding) => {
      const evidence = (finding.evidence ?? [])
        .map((ref) => (typeof ref === 'string' ? ref : ref.issue))
        .map((id) => {
          const issue = index.get(id);
          if (issue === undefined) console.error(`warning: finding "${finding.title}" cites unknown issue ${id}`);
          return issue;
        })
        .filter(Boolean);
      const personas = [...new Set([...(finding.personas ?? []), ...evidence.map((issue) => issue.session.split('--')[0])])];
      const blocked = personas.some((persona) => failedPersonas.has(persona));
      const score = SEVERITY_WEIGHT[finding.severity] * personas.length + (blocked ? 2 : 0);
      return {
        ...(typeof finding.known === 'string' ? { known: finding.known } : {}),
        title: finding.title,
        severity: finding.severity,
        category: finding.category ?? 'ux',
        summary: finding.summary ?? '',
        suggested_fix: finding.suggested_fix ?? '',
        personas,
        evidence,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || a.title.localeCompare(b.title));

  return findings.map((finding, position) => ({ ...finding, rank: position + 1, id: `ISSUE-${position + 1}` }));
}

/**
 * Claude Code reports a token figure per subagent, but not the split between fresh input, cache reads and output,
 * so no honest price can be derived from it. Report the tokens and point at the billed figure.
 */
export function estimateCost(usage) {
  const total = usage.reduce((sum, entry) => sum + (Number(entry.total_tokens) || 0), 0);
  if (total === 0) return { tokens: 0, label: 'not recorded' };
  return { tokens: total, label: `${Math.round(total / 1000).toLocaleString('en-GB')}K tokens` };
}

export function buildData(runDir, loaded) {
  const swept = loaded.sessions.filter((session) => session.facts.persona === 'sweep');
  const run = { ...loaded, sessions: loaded.sessions.filter((session) => session.facts.persona !== 'sweep') };
  const first = run.sessions[0]?.facts ?? {};
  const personas = [...new Map(run.sessions.map((session) => [session.facts.persona, session])).values()].map((session) => ({
    id: session.facts.persona,
    name: session.journal === '' ? session.facts.persona : nameFromJournal(join(runDir, session.dir, 'journal.md'), session.facts.persona),
  }));
  const names = new Map(personas.map((persona) => [persona.id, persona.name]));

  return {
    app: run.app ?? readAppName(runDir) ?? 'App',
    run_id: basename(runDir),
    generated_at: new Date().toISOString(),
    base_url: first.base_url ?? '',
    personas,
    sessions: run.sessions.map((session) => ({
      ...session.facts,
      dir: session.dir,
      persona_name: names.get(session.facts.persona) ?? session.facts.persona,
      journal: session.journal,
      screenshots: session.screenshots,
      trace: session.trace,
    })),
    ...applyTriage(rankFindings(run.findings?.findings ?? fallbackFindings(run.sessions), run.sessions), loadTriage(runDir)),
    coordinated: run.findings !== null,
    cost: estimateCost(run.usage),
    sweep_pages: swept.reduce((sum, session) => sum + (readJson(join(runDir, session.dir, 'a11y.json'), { scans: [] }).scans ?? []).length, 0),
    a11y: bySeverity(run.a11y?.findings),
    ux: bySeverity(run.ux?.findings),
  };
}

/** Hides dismissed findings (remembered across runs) and marks confirmed or filed ones. */
export function applyTriage(ranked, triage) {
  const visible = [];
  let dismissed = 0;
  for (const finding of ranked) {
    const decision = triage.findings?.[keyFor(finding)];
    if (decision?.status === 'dismissed') {
      dismissed += 1;
      continue;
    }
    visible.push({ ...finding, status: decision?.status ?? 'new', ...(decision?.github_issue ? { github_issue: decision.github_issue } : {}) });
  }
  return {
    findings: visible.map((finding, position) => ({ ...finding, rank: position + 1, id: `ISSUE-${position + 1}` })),
    dismissed,
  };
}

function bySeverity(findings) {
  if (!Array.isArray(findings)) return null;
  return findings
    .filter((finding) => SEVERITY_WEIGHT[finding.severity] !== undefined)
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);
}

function nameFromJournal(file, fallback) {
  const heading = readFileSync(file, 'utf8').split('\n')[0] ?? '';
  return heading.replace(/^#\s*/, '').split(' - ')[0] || fallback;
}

function readAppName(runDir) {
  const config = join(runDir, '..', '..', 'config.yaml');
  if (!existsSync(config)) return null;
  const match = /^\s+name:\s*(.+)$/m.exec(readFileSync(config, 'utf8'));
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null;
}

export function summaryMarkdown(data, reportPath) {
  const outcome = (name) => data.sessions.filter((session) => session.outcome === name).length;
  const lines = [
    `## PersonaQA: ${data.app}`,
    '',
  ];
  if (data.sessions.length > 0) {
    lines.push(
      `${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'}: ${outcome('success')} reached the goal, ${outcome('abandoned')} gave up, ${outcome('limit')} hit a limit, ${outcome('incomplete')} unfinished.`,
      '',
      '| Persona | Mission | Outcome | Steps | Longest wait |',
      '|---|---|---|---|---|',
      ...data.sessions.map((session) => `| ${session.persona_name} | ${session.mission} | ${session.outcome} | ${session.steps} | ${session.longest_wait_seconds}s |`),
      '',
    );
  }
  if (data.sweep_pages > 0) lines.push(`Accessibility sweep: ${data.sweep_pages} page state${data.sweep_pages === 1 ? '' : 's'} scanned with no persona.`, '');

  for (const [label, list] of [['Accessibility', data.a11y], ['UX', data.ux]]) {
    if (list === null) continue;
    const serious = list.filter((finding) => ['critical', 'high'].includes(finding.severity)).length;
    lines.push(`${label} inspector: ${list.length} finding${list.length === 1 ? '' : 's'}, ${serious} high or critical.`, '');
  }

  if (data.findings.length === 0) {
    lines.push('No issues were recorded.');
  } else {
    lines.push(
      `### Top findings${data.coordinated ? '' : ' (not yet merged by the coordinator)'}`,
      '',
      '| # | Severity | Finding | Personas |',
      '|---|---|---|---|',
      ...data.findings.slice(0, 10).map((finding) => `| ${finding.id} | ${finding.severity} | ${finding.title.replaceAll('|', '/')} | ${finding.personas.length} |`),
    );
    if (data.findings.length > 10) lines.push('', `${data.findings.length - 10} more in the report.`);
  }
  if (data.dismissed > 0) lines.push('', `${data.dismissed} previously dismissed finding${data.dismissed === 1 ? ' is' : 's are'} hidden.`);

  lines.push(
    '',
    data.cost.tokens > 0
      ? `Model usage: ${data.cost.tokens.toLocaleString('en-GB')} tokens reported by Claude Code across the persona runners (not a bill: the billed cost, including inspectors and the coordinator, is in \`claude -p --output-format json\` as \`total_cost_usd\`, or your usage page).`
      : 'Model usage: not recorded.',
    '',
    `Full report: \`${reportPath}\``,
    '',
  );
  return lines.join('\n');
}

export function renderReport(template, data, logos) {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return template
    .replace('{{LOGO_ON_LIGHT}}', logos.onLight)
    .replace('{{LOGO_ON_DARK}}', logos.onDark)
    .replace('{{DATA_JSON}}', () => json);
}

/**
 * Finds the plugin's downloaded browser. Scripts run through Bash do not get CLAUDE_PLUGIN_DATA, so work it out from
 * where the plugin is installed (plugins/cache/<marketplace>/<plugin>/<version> maps to plugins/data/<plugin>-<marketplace>).
 */
export function browserCandidates(pluginRoot, home = homedir()) {
  const candidates = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) candidates.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  const parts = pluginRoot.split(sep);
  const cache = parts.lastIndexOf('cache');
  if (cache > 0 && parts[cache - 1] === 'plugins' && parts.length >= cache + 3) {
    const data = [...parts.slice(0, cache), 'data', `${parts[cache + 2]}-${parts[cache + 1]}`].join(sep);
    candidates.push(join(data, 'browsers'));
  }
  const dataRoot = join(home, '.claude', 'plugins', 'data');
  if (existsSync(dataRoot)) {
    for (const name of readdirSync(dataRoot).filter((entry) => entry.startsWith('personaqa')).sort()) {
      candidates.push(join(dataRoot, name, 'browsers'));
    }
  }
  return candidates;
}

function loadPlaywright(pluginRoot) {
  const browsers = browserCandidates(pluginRoot).find((path) => existsSync(path));
  if (browsers !== undefined) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  for (const origin of [import.meta.url, pathToFileURL(join(pluginRoot, 'package.json')).href]) {
    try {
      return createRequire(origin)('playwright');
    } catch {
      // try the next location
    }
  }
  return null;
}

/** Screenshots the report shows: each finding's evidence and the last six per session. */
function shownScreenshots(data) {
  const paths = new Set();
  for (const finding of data.findings) {
    for (const item of finding.evidence) if (item.screenshot) paths.add(`${item.session}/${item.screenshot}`);
  }
  for (const session of data.sessions) {
    for (const path of session.screenshots.slice(-6)) paths.add(`${session.dir}/${path}`);
  }
  return [...paths];
}

/** Writes report.pdf (every section expanded) and report-standalone.html (screenshots embedded and shrunk). */
export async function exportReport(runDir, data, template, logos, pluginRoot) {
  const playwright = loadPlaywright(pluginRoot);
  if (playwright === null) return { pdf: null, standalone: null, warning: 'Playwright is not available, so the PDF and standalone exports were skipped.' };

  let browser;
  try {
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const images = {};
    for (const path of shownScreenshots(data)) {
      const file = join(runDir, path);
      if (!existsSync(file)) continue;
      const source = `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`;
      images[path] = await page.evaluate(async (uri) => {
        const image = new Image();
        image.src = uri;
        await image.decode();
        const scale = Math.min(1, 480 / image.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.72);
      }, source);
    }
    writeFileSync(join(runDir, 'report-standalone.html'), renderReport(template, { ...data, standalone: true, images }, logos));

    // Print from the standalone copy: its screenshots are already shrunk, which keeps the PDF small
    await page.goto(pathToFileURL(join(runDir, 'report-standalone.html')).href);
    await page.evaluate(() => window.personaqaPrint());
    await page.waitForLoadState('load');
    await page.evaluate(async () => {
      await Promise.all([...document.images].filter((image) => !image.complete).map((image) => new Promise((done) => { image.onload = image.onerror = done; })));
    });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: join(runDir, 'report.pdf'), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
    return { pdf: join(runDir, 'report.pdf'), standalone: join(runDir, 'report-standalone.html'), warning: null };
  } catch (error) {
    return { pdf: null, standalone: null, warning: `Export failed: ${error.message.split('\n')[0]}` };
  } finally {
    await browser?.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skipExport = args.includes('--no-export');
  const runArg = args.find((arg) => !arg.startsWith('--'));
  const runDir = runArg === undefined ? undefined : resolve(runArg);
  if (runDir === undefined || !existsSync(runDir)) {
    console.error('usage: node scripts/report.mjs <run-dir> [--no-export]');
    process.exit(1);
  }

  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataUri = (file) => `data:image/webp;base64,${readFileSync(join(pluginRoot, 'templates', file)).toString('base64')}`;
  const logos = { onLight: dataUri('logo-dark.webp'), onDark: dataUri('logo-light.webp') };
  const data = { ...buildData(runDir, loadRun(runDir)), exports: skipExport ? {} : { pdf: 'report.pdf', standalone: 'report-standalone.html' } };
  const template = readFileSync(join(pluginRoot, 'templates', 'report.html'), 'utf8');

  writeFileSync(join(runDir, 'report.json'), `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(join(runDir, 'report.html'), renderReport(template, data, logos));
  writeFileSync(join(runDir, 'summary.md'), summaryMarkdown(data, join(runDir, 'report.html')));

  const link = (path) => pathToFileURL(path).href;
  console.log(`report: ${link(join(runDir, 'report.html'))}`);
  console.log(`summary: ${join(runDir, 'summary.md')}`);

  if (!skipExport) {
    const exported = await exportReport(runDir, data, template, logos, pluginRoot);
    if (exported.pdf !== null) console.log(`pdf: ${link(exported.pdf)}`);
    if (exported.standalone !== null) console.log(`standalone: ${link(exported.standalone)}`);
    if (exported.warning !== null) {
      console.error(`warning: ${exported.warning}`);
      writeFileSync(join(runDir, 'report.html'), renderReport(template, { ...data, exports: {} }, logos));
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
