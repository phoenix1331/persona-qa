#!/usr/bin/env node
// Saves screenshots of a run's report.html for the docs: findings, an expanded finding, sessions, accessibility, UX.
// Usage: node docs/media/capture-report.mjs <run-folder>
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, '..', '..', 'package.json'))('playwright');
const report = pathToFileURL(join(resolve(process.argv[2] ?? ''), 'report.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const shot = (name) => page.screenshot({ path: join(here, `report-${name}.jpg`), type: 'jpeg', quality: 82 });
const tab = (name) => page.getByRole('tab', { name }).click();

await page.goto(report);
await shot('findings');
await page.locator('details').first().evaluate((element) => {
  element.open = true;
});
await page.locator('article').first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 230));
await shot('evidence');
await page.evaluate(() => window.scrollTo(0, 0));
await tab('Sessions');
await shot('sessions');
await tab('Accessibility');
await shot('accessibility');
await tab('UX');
await shot('ux');
await browser.close();
console.log('saved report-*.jpg');
