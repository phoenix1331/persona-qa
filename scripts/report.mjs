#!/usr/bin/env node
// Renders summary.md and report.html for one run folder.
// Usage: node scripts/report.mjs <run-dir>
// Reads each session's run.json, issues.json and journal.md, plus optional findings.json (written by the
// coordinator), usage.json (written by the run skill), a11y.json and ux.json. Ranking and cost are computed here,
// deterministically; merging duplicate issues is the coordinator's judgement.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_WEIGHT = { critical: 8, high: 5, medium: 3, low: 1 };

/** USD per million tokens. Low assumes nearly all input was cache reads; high assumes none was. */
const PRICES = {
  sonnet: { low: 0.1, high: 2.0 },
  haiku: { low: 0.01, high: 0.1 },
};

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

export function estimateCost(usage) {
  const total = usage.reduce((sum, entry) => sum + (Number(entry.total_tokens) || 0), 0);
  if (total === 0) return { tokens: 0, low: null, high: null, label: 'not recorded' };

  let low = 0;
  let high = 0;
  let priced = true;
  for (const entry of usage) {
    const family = Object.keys(PRICES).find((name) => String(entry.model ?? 'sonnet').toLowerCase().includes(name));
    if (family === undefined) {
      priced = false;
      continue;
    }
    const millions = (Number(entry.total_tokens) || 0) / 1_000_000;
    low += millions * PRICES[family].low;
    high += millions * PRICES[family].high;
  }

  const format = (value) => `$${value.toFixed(2)}`;
  const label = priced ? `${format(low)} to ${format(high)}` : `${total.toLocaleString('en-GB')} tokens`;
  return { tokens: total, low: priced ? low : null, high: priced ? high : null, label };
}

export function buildData(runDir, run) {
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
    findings: rankFindings(run.findings?.findings ?? fallbackFindings(run.sessions), run.sessions),
    coordinated: run.findings !== null,
    cost: estimateCost(run.usage),
    a11y: bySeverity(run.a11y?.findings),
    ux: bySeverity(run.ux?.findings),
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
    `${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'}: ${outcome('success')} reached the goal, ${outcome('abandoned')} gave up, ${outcome('limit')} hit a limit, ${outcome('incomplete')} unfinished.`,
    '',
    '| Persona | Mission | Outcome | Steps | Longest wait |',
    '|---|---|---|---|---|',
    ...data.sessions.map((session) => `| ${session.persona_name} | ${session.mission} | ${session.outcome} | ${session.steps} | ${session.longest_wait_seconds}s |`),
    '',
  ];

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

  lines.push(
    '',
    `Estimated model cost: ${data.cost.label}${data.cost.tokens > 0 ? ` (${data.cost.tokens.toLocaleString('en-GB')} tokens as reported by Claude Code)` : ''}.`,
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

function main() {
  const runDir = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
  if (runDir === undefined || !existsSync(runDir)) {
    console.error('usage: node scripts/report.mjs <run-dir>');
    process.exit(1);
  }

  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataUri = (file) => `data:image/webp;base64,${readFileSync(join(pluginRoot, 'templates', file)).toString('base64')}`;
  const data = buildData(runDir, loadRun(runDir));
  const template = readFileSync(join(pluginRoot, 'templates', 'report.html'), 'utf8');

  writeFileSync(join(runDir, 'report.html'), renderReport(template, data, { onLight: dataUri('logo-dark.webp'), onDark: dataUri('logo-light.webp') }));
  writeFileSync(join(runDir, 'summary.md'), summaryMarkdown(data, join(runDir, 'report.html')));
  console.log(`report: ${join(runDir, 'report.html')}`);
  console.log(`summary: ${join(runDir, 'summary.md')}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
