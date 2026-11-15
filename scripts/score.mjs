#!/usr/bin/env node
// Scores a PersonaQA run against an answer key of planted flaws, deterministically.
// Usage: node scripts/score.mjs <run-dir> <flaws.yaml>
// Each flaw lists `match` groups; a flaw counts as found when every term of any one group appears in a finding
// (title, summary, detail and evidence text, case-insensitive). Writes score.json and score.md in the run folder.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** Every piece of text the run produced that could describe a flaw, tagged with where it came from. */
export function collectFindings(runDir) {
  const findings = [];
  const issues = new Map();

  for (const dir of readdirSync(runDir).filter((name) => statSync(join(runDir, name)).isDirectory()).sort()) {
    const recorded = readJson(join(runDir, dir, 'issues.json'))?.issues ?? [];
    for (const issue of recorded) issues.set(issue.id, issue);
    if (readJson(join(runDir, 'findings.json')) === null) {
      for (const issue of recorded) {
        findings.push({ source: `issue ${issue.id}`, personas: [dir.split('--')[0]], text: [issue.title, issue.what_happened, issue.expected].join(' ') });
      }
    }
  }

  for (const finding of readJson(join(runDir, 'findings.json'))?.findings ?? []) {
    const evidence = (finding.evidence ?? []).map((id) => issues.get(typeof id === 'string' ? id : id.issue)).filter(Boolean);
    findings.push({
      source: `finding "${finding.title}"`,
      personas: finding.personas ?? [],
      text: [finding.title, finding.summary, finding.suggested_fix, ...evidence.flatMap((issue) => [issue.title, issue.what_happened])].join(' '),
    });
  }

  for (const [file, label] of [['a11y.json', 'a11y'], ['ux.json', 'ux']]) {
    for (const finding of readJson(join(runDir, file))?.findings ?? []) {
      findings.push({ source: `${label} "${finding.title}"`, personas: finding.personas ?? [], text: [finding.title, finding.detail, ...(finding.tags ?? [])].join(' ') });
    }
  }

  return findings.map((finding) => ({ ...finding, text: finding.text.toLowerCase() }));
}

export function matches(flaw, finding) {
  return (flaw.match ?? []).some((group) => group.every((term) => finding.text.includes(String(term).toLowerCase())));
}

export function score(flaws, findings) {
  const results = flaws.map((flaw) => {
    const hits = findings.filter((finding) => matches(flaw, finding));
    return {
      id: flaw.id,
      title: flaw.title,
      category: flaw.category,
      found: hits.length > 0,
      by: hits.map((hit) => hit.source),
      personas: [...new Set(hits.flatMap((hit) => hit.personas))].sort(),
    };
  });

  const unmatched = findings.filter((finding) => !flaws.some((flaw) => matches(flaw, finding))).map((finding) => finding.source);
  const categories = [...new Set(flaws.map((flaw) => flaw.category))].map((category) => {
    const inCategory = results.filter((result) => result.category === category);
    return { category, found: inCategory.filter((result) => result.found).length, total: inCategory.length };
  });

  return {
    found: results.filter((result) => result.found).length,
    total: results.length,
    categories,
    flaws: results,
    unmatched_findings: unmatched,
    unscorable: flaws.filter((flaw) => (flaw.match ?? []).length === 0).map((flaw) => flaw.id),
  };
}

export function markdown(result) {
  const percent = result.total === 0 ? 0 : Math.round((result.found / result.total) * 100);
  return [
    `## Found ${result.found} of ${result.total} planted flaws (${percent}%)`,
    '',
    result.categories.map((category) => `${category.category}: ${category.found} of ${category.total}`).join(' · '),
    '',
    '| Flaw | Found | By | Personas |',
    '|---|---|---|---|',
    ...result.flaws.map((flaw) => `| ${flaw.id} ${flaw.title} | ${flaw.found ? 'yes' : 'no'} | ${flaw.by.length} | ${flaw.personas.join(', ')} |`),
    '',
    `${result.unmatched_findings.length} finding${result.unmatched_findings.length === 1 ? '' : 's'} matched no planted flaw (real issues or noise; review them by hand).`,
    result.unscorable.length > 0 ? `\nFlaws with no match rules, so never counted: ${result.unscorable.join(', ')}.` : '',
    '',
  ].join('\n');
}

function main() {
  const [runArg, flawsArg] = process.argv.slice(2);
  if (runArg === undefined || flawsArg === undefined) {
    console.error('usage: node scripts/score.mjs <run-dir> <flaws.yaml>');
    process.exit(1);
  }

  const runDir = resolve(runArg);
  const flaws = parse(readFileSync(resolve(flawsArg), 'utf8')).flaws ?? [];
  const result = score(flaws, collectFindings(runDir));
  writeFileSync(join(runDir, 'score.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(runDir, 'score.md'), markdown(result));
  process.stdout.write(markdown(result));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
