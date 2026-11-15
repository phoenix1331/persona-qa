#!/usr/bin/env node
// Records triage decisions for findings and prepares GitHub issues, deterministically.
// Usage:
//   node scripts/triage.mjs confirm <run-dir> <ISSUE-n>...
//   node scripts/triage.mjs dismiss <run-dir> <ISSUE-n> <reason>
//   node scripts/triage.mjs filed <run-dir> <ISSUE-n> <issue-url>
//   node scripts/triage.mjs github <run-dir> [--min-severity medium] [--labels a,b] [--all] [ISSUE-n...]
// Decisions live in triage.json next to the runs folder (.personaqa/triage.json), committed so the team shares them.
// The coordinator reuses a finding's key (`known`) in later runs, so dismissed problems are not raised again.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

export function triagePath(runDir) {
  return process.env.PERSONAQA_TRIAGE || join(resolve(runDir), '..', '..', 'triage.json');
}

export function loadTriage(runDir) {
  const path = triagePath(runDir);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { findings: {} };
}

function saveTriage(runDir, triage) {
  writeFileSync(triagePath(runDir), `${JSON.stringify(triage, null, 2)}\n`);
}

export function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function loadReport(runDir) {
  const file = join(resolve(runDir), 'report.json');
  if (!existsSync(file)) throw new Error(`No report.json in ${runDir}. Run scripts/report.mjs first.`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function findFinding(report, id) {
  const finding = report.findings.find((candidate) => candidate.id.toLowerCase() === id.toLowerCase());
  if (finding === undefined) {
    throw new Error(`No ${id} in this run. Available: ${report.findings.map((candidate) => candidate.id).join(', ') || 'none'}`);
  }
  return finding;
}

export function keyFor(finding) {
  return finding.known ?? slug(finding.title);
}

export function record(runDir, id, update) {
  const report = loadReport(runDir);
  const finding = findFinding(report, id);
  const triage = loadTriage(runDir);
  const key = keyFor(finding);
  triage.findings[key] = {
    ...triage.findings[key],
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    ...update,
    run: report.run_id,
    at: new Date().toISOString(),
  };
  saveTriage(runDir, triage);
  return { key, ...triage.findings[key] };
}

/** Labels: configured ones, the category, and wcag-x.y.z for every criterion mentioned. */
export function labelsFor(finding, base) {
  const text = [finding.title, finding.summary, finding.suggested_fix, ...(finding.tags ?? [])].join(' ');
  const criteria = [...text.matchAll(/\b(?:WCAG\s*)?([1-4]\.\d{1,2}\.\d{1,2})\b/g)].map((match) => `wcag-${match[1]}`);
  return [...new Set([...base, finding.category === 'a11y' || criteria.length > 0 ? 'a11y' : finding.category, ...criteria])].filter(Boolean);
}

export function issueBody(finding, report) {
  const names = new Map(report.personas.map((persona) => [persona.id, persona.name]));
  const lines = [
    `**Severity:** ${finding.severity} · **Category:** ${finding.category} · **Personas affected:** ${finding.personas.map((id) => names.get(id) ?? id).join(', ') || 'none recorded'}`,
    '',
    finding.summary,
    '',
  ];
  if (finding.suggested_fix) lines.push(`**Suggested fix:** ${finding.suggested_fix}`, '');
  if (finding.evidence.length > 0) {
    lines.push('### Evidence', '');
    for (const item of finding.evidence) {
      lines.push(
        `- **${item.session}**, step ${item.step}, \`${item.url}\``,
        `  - What happened: ${item.what_happened}`,
        `  - Expected: ${item.expected}`,
      );
    }
    lines.push('');
  }
  lines.push(
    `Found by PersonaQA in run \`${report.run_id}\` against ${report.base_url}. Screenshots, journals and traces are in \`.personaqa/runs/${report.run_id}/\`.`,
    '',
    'To reproduce deterministically: `/personaqa:test ' + finding.id + '`',
  );
  return lines.join('\n');
}

export function githubCandidates(runDir, options) {
  const report = loadReport(runDir);
  const triage = loadTriage(runDir);
  const minimum = SEVERITY_ORDER.indexOf(options.minSeverity ?? 'medium');
  const wanted = options.ids.length > 0 ? options.ids.map((id) => findFinding(report, id)) : report.findings;

  return wanted
    .filter((finding) => {
      const decision = triage.findings[keyFor(finding)];
      if (decision?.status === 'dismissed' || decision?.github_issue) return false;
      if (options.ids.length > 0) return true;
      if (SEVERITY_ORDER.indexOf(finding.severity) < minimum) return false;
      return options.all === true || decision?.status === 'confirmed';
    })
    .map((finding) => ({
      id: finding.id,
      key: keyFor(finding),
      title: `[PersonaQA] ${finding.title}`,
      labels: labelsFor(finding, options.labels ?? ['personaqa']),
      body: issueBody(finding, report),
    }));
}

function main() {
  const [command, runDir, ...rest] = process.argv.slice(2);
  if (command === undefined || runDir === undefined) {
    console.error('usage: node scripts/triage.mjs <confirm|dismiss|filed|github> <run-dir> ...');
    process.exit(1);
  }

  try {
    if (command === 'confirm') {
      for (const id of rest) console.log(JSON.stringify(record(runDir, id, { status: 'confirmed' })));
      return;
    }
    if (command === 'dismiss') {
      const [id, ...reason] = rest;
      console.log(JSON.stringify(record(runDir, id, { status: 'dismissed', reason: reason.join(' ') || 'not given' })));
      return;
    }
    if (command === 'filed') {
      const [id, url] = rest;
      console.log(JSON.stringify(record(runDir, id, { status: 'confirmed', github_issue: url })));
      return;
    }
    if (command === 'github') {
      const options = { ids: [], all: false };
      for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === '--min-severity') options.minSeverity = rest[++index];
        else if (arg === '--labels') options.labels = rest[++index].split(',').map((label) => label.trim());
        else if (arg === '--all') options.all = true;
        else options.ids.push(arg);
      }
      console.log(JSON.stringify(githubCandidates(runDir, options), null, 2));
      return;
    }
    throw new Error(`Unknown command "${command}"`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
