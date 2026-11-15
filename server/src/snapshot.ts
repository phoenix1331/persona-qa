import type { Page } from 'playwright';
import { type ScriptLine, type ScriptOutput, collectSnapshot } from './snapshot-script.js';

export interface SnapshotState {
  nextRef: number;
  previous?: { url: string; lines: string[] };
}

export interface Snapshot {
  text: string;
  /** Rough token estimate (characters / 4) for cost accounting and tests. */
  tokens: number;
  diffed: boolean;
}

/** Only diff when the change is small enough to be worth it. */
const DIFF_RATIO = 0.6;

export async function takeSnapshot(page: Page, state: SnapshotState): Promise<Snapshot> {
  const output = await collect(page, state.nextRef);
  state.nextRef = output.nextRef;

  const onScreen = output.lines.filter((line) => line.visible).map((line) => line.text);
  const header = headerFor(output);
  const footer = offScreenSummary(output);
  const previous = state.previous;
  state.previous = { url: output.url, lines: onScreen };

  if (previous !== undefined && previous.url === output.url) {
    const changes = diffLines(previous.lines, onScreen);
    const changed = changes.filter((line) => !line.startsWith('  ')).length;

    if (changed === 0) {
      return finish([header, 'Nothing on screen has changed since you last looked.', footer]);
    }

    if (changed <= Math.max(onScreen.length, previous.lines.length) * DIFF_RATIO) {
      const shown = changes.filter((line) => !line.startsWith('  '));
      return finish(
        [header, 'Changes since you last looked (+ new, - gone):', ...shown, footer],
        true,
      );
    }
  }

  return finish([header, ...(onScreen.length > 0 ? onScreen : ['(The screen is blank.)']), footer]);
}

/** A navigation can replace the document mid-read; wait for the new one and try again. */
async function collect(page: Page, nextRef: number, attempts = 3): Promise<ScriptOutput> {
  try {
    return await page.evaluate(collectSnapshot, { nextRef });
  } catch (error) {
    const navigating = /Execution context was destroyed|navigation/i.test((error as Error).message);
    if (!navigating || attempts <= 1) {
      throw error;
    }
    await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
    return collect(page, nextRef, attempts - 1);
  }
}

/** The whole page as lines, on screen or not, for inspectors. Shares the session's ref counter so refs stay unique. */
export async function pageOutline(
  page: Page,
  state: SnapshotState,
  maxChars = 6000,
): Promise<string> {
  const output = await collect(page, state.nextRef);
  state.nextRef = output.nextRef;
  const text = output.lines.map((line) => line.text).join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function finish(parts: string[], diffed = false): Snapshot {
  const text = parts.filter((part) => part !== '').join('\n');
  return { text, tokens: Math.ceil(text.length / 4), diffed };
}

function headerFor(output: ScriptOutput): string {
  const url = new URL(output.url);
  const path = url.protocol.startsWith('http') ? `${url.pathname}${url.search}` : output.url;
  const scrollable = output.pageHeight > output.viewport.height + 1;
  const position = scrollable
    ? `, scrolled ${output.scrollY}px of ${output.pageHeight - output.viewport.height}px`
    : '';

  return `Page: ${output.title || '(untitled)'}\nURL: ${path}\nScreen: ${output.viewport.width}x${output.viewport.height}${position}\n`;
}

function offScreenSummary(output: ScriptOutput): string {
  const above = output.lines.filter((line) => !line.visible && line.above);
  const below = output.lines.filter((line) => !line.visible && !line.above);
  const parts: string[] = [];

  if (above.length > 0) {
    parts.push(`Above the screen: ${describe(above)}.`);
  }

  if (below.length > 0) {
    const remaining = output.pageHeight - output.scrollY - output.viewport.height;
    const screens = Math.max(1, Math.round(remaining / output.viewport.height));
    parts.push(
      `Below the screen: ${describe(below)}, about ${screens} screen${screens === 1 ? '' : 's'} more.`,
    );
  }

  return parts.length > 0 ? `\n${parts.join(' ')}` : '';
}

function describe(lines: ScriptLine[]): string {
  const controls = lines.reduce((sum, line) => sum + line.controls, 0);
  const text = `${lines.length} line${lines.length === 1 ? '' : 's'} of content`;
  return controls > 0 ? `${text} with ${controls} control${controls === 1 ? '' : 's'}` : text;
}

/** Line diff via longest common subsequence: "  " kept, "+ " added, "- " removed. */
export function diffLines(before: string[], after: string[]): string[] {
  const rows = before.length;
  const cols = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      row[j] =
        before[i] === after[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      result.push(`  ${before[i]}`);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      result.push(`- ${before[i]}`);
      i += 1;
    } else {
      result.push(`+ ${after[j]}`);
      j += 1;
    }
  }

  while (i < rows) result.push(`- ${before[i++]}`);
  while (j < cols) result.push(`+ ${after[j++]}`);

  return result;
}
