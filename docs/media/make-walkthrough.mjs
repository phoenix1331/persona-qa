#!/usr/bin/env node
// Builds docs/media/walkthrough.gif from a persona's run folder and the storyboard in walkthrough.json.
// Usage: node docs/media/make-walkthrough.mjs <session-folder> [storyboard.json] [output.gif]   (needs ffmpeg and the root npm install)
// Frames: { shot } is a screenshot from the session, { image } any image under docs/media, { outro } a closing card.
// Wide images get a stacked layout (screen above the caption), tall ones a side-by-side layout.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const session = resolve(process.argv[2] ?? '');
const board = JSON.parse(readFileSync(resolve(process.argv[3] ?? join(here, 'walkthrough.json')), 'utf8'));
const output = resolve(process.argv[4] ?? join(here, 'walkthrough.gif'));
const width = 960;
const height = 600;

const dataUri = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
const logo = dataUri(join(root, 'templates', 'logo-dark.webp'), 'image/webp');
const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

const style = `
  * { box-sizing: border-box; margin: 0; }
  body { width: ${width}px; height: ${height}px; font-family: system-ui, "Segoe UI", Roboto, sans-serif; background: #f4f5f7; color: #16181d; display: flex; }
  .screen { width: 405px; height: ${height}px; padding: 18px; display: flex; align-items: center; justify-content: center; background: #16181d; }
  .screen img { max-width: 369px; max-height: 504px; border-radius: 14px; box-shadow: 0 0 0 6px #2c313a; }
  .side { flex: 1; padding: 30px 34px; display: flex; flex-direction: column; }
  .logo { height: 34px; align-self: flex-start; }
  .who { margin-top: 22px; font-weight: 700; font-size: 20px; }
  .env { color: #5d6573; font-size: 15px; margin-top: 2px; }
  .mission { color: #5d6573; font-size: 15px; margin-top: 10px; border-left: 3px solid #ff6b00; padding-left: 10px; }
  .step { margin-top: auto; color: #ff6b00; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 14px; }
  .caption { font-size: 25px; line-height: 1.32; font-weight: 600; margin-top: 8px; }
  .detail { margin-top: 14px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14px; color: #3b4250; background: #e7eaef; padding: 6px 10px; border-radius: 6px; align-self: flex-start; }
  .issue { margin-top: 14px; align-self: flex-start; font-weight: 700; font-size: 14px; color: #fff; padding: 5px 12px; border-radius: 999px; }
  .issue.medium { background: #b08800; } .issue.high { background: #d9480f; }
  .stacked { flex-direction: column; background: #16181d; }
  .stacked .frame { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px 16px 10px; min-height: 0; }
  .stacked .frame img { max-width: 928px; max-height: 100%; border-radius: 10px; border: 1px solid #2c313a; }
  .bar { background: #fff; padding: 14px 22px; display: flex; gap: 18px; align-items: center; }
  .bar .logo { height: 26px; align-self: center; }
  .bar .text { flex: 1; }
  .bar .meta { color: #5d6573; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .bar .meta b { color: #ff6b00; }
  .bar .caption { font-size: 19px; margin-top: 2px; line-height: 1.3; }
  .bar .detail, .bar .issue { margin-top: 0; }
  .outro { width: ${width}px; height: ${height}px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: #fff; }
  .outro img { height: 64px; }
  .outro h1 { font-size: 34px; margin-top: 18px; }
  .outro p { font-size: 21px; color: #3b4250; }
  .outro p:last-child { color: #ff6b00; font-weight: 700; }
`;

function imageSize(path) {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) === 'PNG') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  for (let offset = 2; offset < buffer.length; ) {
    const marker = buffer.readUInt16BE(offset);
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    offset += 2 + length;
  }
  return { width: 1, height: 1 };
}

function frameHtml(frame) {
  if (frame.outro) {
    return { body: `<div class="outro"><img src="${logo}" alt=""><h1>${escape(frame.title)}</h1>${frame.lines.map((line) => `<p>${escape(line)}</p>`).join('')}</div>`, cls: '' };
  }
  const path = frame.shot ? join(session, 'screenshots', frame.shot) : join(here, frame.image);
  const src = dataUri(path, path.endsWith('.png') ? 'image/png' : 'image/jpeg');
  const { width: w, height: h } = imageSize(path);
  const extras = `${frame.detail ? `<div class="detail">${escape(frame.detail)}</div>` : ''}${frame.issue ? `<div class="issue ${frame.issue}">Issue recorded · ${frame.issue}</div>` : ''}`;

  if (w >= h) {
    const label = frame.label ?? `${board.persona} · ${board.environment}`;
    return {
      cls: 'stacked',
      body: `
        <div class="frame"><img src="${src}" alt=""></div>
        <div class="bar">
          <img class="logo" src="${logo}" alt="">
          <div class="text">
            <div class="meta"><b>${escape(frame.step)}</b> · ${escape(label)}</div>
            <div class="caption">${escape(frame.caption)}</div>
          </div>
          ${extras}
        </div>`,
    };
  }

  return {
    cls: '',
    body: `
    <div class="screen"><img src="${src}" alt=""></div>
    <div class="side">
      <img class="logo" src="${logo}" alt="">
      <div class="who">${escape(board.persona)}</div>
      <div class="env">${escape(board.environment)}</div>
      <div class="mission">${escape(board.mission)}</div>
      <div class="step">${escape(frame.step)}</div>
      <div class="caption">${escape(frame.caption)}</div>
      ${extras}
    </div>`,
  };
}

const work = mkdtempSync(join(tmpdir(), 'personaqa-gif-'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
const list = [];

for (const [index, frame] of board.frames.entries()) {
  const { body, cls } = frameHtml(frame);
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body class="${cls}">${body}</body></html>`);
  await page.waitForLoadState('load');
  const file = join(work, `frame-${String(index).padStart(2, '0')}.png`);
  await page.screenshot({ path: file });
  list.push(`file '${file}'`, `duration ${frame.seconds}`);
}
await browser.close();

// The concat demuxer needs the last file repeated so its duration is honoured
list.push(list[list.length - 2]);
const listFile = join(work, 'frames.txt');
writeFileSync(listFile, `${list.join('\n')}\n`);
const palette = join(work, 'palette.png');

execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=10,palettegen=max_colors=256:stats_mode=diff', palette]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', palette, '-lavfi', 'fps=10[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle', '-loop', '0', output]);
console.log(`wrote ${output}`);
