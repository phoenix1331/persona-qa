/**
 * Runs inside the page (via page.evaluate) to build a compact, human-scale view of what is on screen.
 * Must stay self-contained: no imports, no closures over module scope.
 */
export interface ScriptInput {
  nextRef: number;
}

export interface ScriptLine {
  text: string;
  visible: boolean;
  above: boolean;
  controls: number;
}

export interface ScriptOutput {
  title: string;
  url: string;
  viewport: { width: number; height: number };
  scrollY: number;
  pageHeight: number;
  lines: ScriptLine[];
  nextRef: number;
}

export function collectSnapshot(input: ScriptInput): ScriptOutput {
  let nextRef = input.nextRef;
  const viewHeight = window.innerHeight;
  const viewWidth = window.innerWidth;
  const lines: ScriptLine[] = [];

  const BLOCK_SKIP = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'HEAD',
    'META',
    'LINK',
    'SVG',
  ]);
  const ROLE_INTERACTIVE = new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'tab',
    'menuitem',
    'switch',
    'combobox',
    'option',
    'slider',
    'textbox',
    'searchbox',
  ]);

  const clean = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim();
  const clip = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;
  const quote = (text: string): string => `"${clip(text, 80).replaceAll('"', "'")}"`;

  const isShown = (element: Element): boolean => {
    if (element.closest('[aria-hidden="true"], [inert]') !== null) {
      return false;
    }
    if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const roleOf = (element: Element): string | null => {
    const explicit = element.getAttribute('role');
    if (explicit !== null && ROLE_INTERACTIVE.has(explicit)) {
      return explicit;
    }

    const tag = element.tagName;
    if (tag === 'A' && element.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const type = (element as HTMLInputElement).type;
      if (type === 'hidden') return null;
      if (type === 'checkbox' || type === 'radio') return type;
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    if (element.getAttribute('contenteditable') === 'true') return 'textbox';

    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) return 'focusable';

    if (element.hasAttribute('onclick') || getComputedStyle(element).cursor === 'pointer') {
      const parent = element.parentElement;
      if (parent === null || getComputedStyle(parent).cursor !== 'pointer') {
        return 'clickable';
      }
    }

    return null;
  };

  const labelText = (element: Element): string => {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy !== null) {
      return clean(
        labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
    }

    const aria = element.getAttribute('aria-label');
    if (aria !== null && clean(aria) !== '') {
      return clean(aria);
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      const labels = Array.from(element.labels ?? [])
        .map((label) => {
          const copy = label.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('input, select, textarea').forEach((child) => child.remove());
          return clean(copy.textContent);
        })
        .filter((text) => text !== '');
      if (labels.length > 0) {
        return labels.join(' ');
      }
      if (
        element instanceof HTMLInputElement &&
        ['submit', 'button', 'reset'].includes(element.type)
      ) {
        return clean(element.value);
      }
      return clean(element.getAttribute('title'));
    }

    const text = clean((element as HTMLElement).innerText);
    if (text !== '') {
      return text;
    }

    const image = element.querySelector('img[alt]');
    return clean(image?.getAttribute('alt') ?? element.getAttribute('title'));
  };

  const coveredBy = (element: Element): string | null => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > viewWidth || y > viewHeight) {
      return null;
    }

    const top = document.elementFromPoint(x, y);
    if (top === null || element.contains(top) || top.contains(element)) {
      return null;
    }

    const labels = element instanceof HTMLInputElement ? Array.from(element.labels ?? []) : [];
    if (labels.some((label) => label.contains(top))) {
      return null;
    }

    let block: Element = top;
    while (block.parentElement !== null && clean((block as HTMLElement).innerText).length < 20) {
      block = block.parentElement;
    }
    return clip(clean((block as HTMLElement).innerText), 50) || top.tagName.toLowerCase();
  };

  const token = (element: Element, role: string): string => {
    let ref = element.getAttribute('data-pqa-ref');
    if (ref === null) {
      ref = `e${nextRef}`;
      nextRef += 1;
      element.setAttribute('data-pqa-ref', ref);
    }

    const name = labelText(element);
    const visible = clean((element as HTMLElement).innerText);
    const states: string[] = [];

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (
        element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio')
      ) {
        states.push(element.checked ? 'checked' : 'not checked');
      } else if (element.value !== '' && role === 'textbox') {
        states.push(element.type === 'password' ? 'value: ••••' : `value: ${quote(element.value)}`);
      } else if (element.placeholder !== '' && role === 'textbox') {
        states.push(`placeholder: ${quote(element.placeholder)}`);
      }
    }
    if (element instanceof HTMLSelectElement) {
      states.push(`selected: ${quote(clean(element.selectedOptions[0]?.textContent))}`);
    }
    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true')
      states.push('disabled');
    if (element.getAttribute('aria-expanded') !== null) {
      states.push(element.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    }
    if (element.getAttribute('aria-invalid') === 'true') states.push('invalid');
    if (element === document.activeElement) states.push('focused');

    const cover = coveredBy(element);
    if (cover !== null) states.push(`covered by "${cover}"`);

    let label = name === '' ? '(no name)' : quote(name);
    if (visible !== '' && name !== '' && visible !== name && role !== 'textbox') {
      label = `${quote(visible)} (read aloud as ${quote(name)})`;
    }

    return `[${ref} ${role} ${label}${states.length > 0 ? ` ${states.join(', ')}` : ''}]`;
  };

  const isBlock = (element: Element): boolean => {
    const display = getComputedStyle(element).display;
    return !display.startsWith('inline') && display !== 'contents';
  };

  const prefixFor = (element: Element): string => {
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} `;
    if (tag === 'LI') return '- ';
    if (tag === 'LEGEND') return 'Group: ';
    const role = element.getAttribute('role');
    if (role === 'alert') return 'Alert: ';
    if (role === 'status') return 'Status: ';
    if (role === 'dialog' || tag === 'DIALOG') return 'Dialog: ';
    return '';
  };

  interface Pending {
    parts: string[];
    visible: boolean;
    above: boolean;
    controls: number;
    prefix: string;
  }

  const fresh = (prefix: string): Pending => ({
    parts: [],
    visible: false,
    above: true,
    controls: 0,
    prefix,
  });

  const place = (pending: Pending, rect: DOMRect): void => {
    if (rect.bottom > 0 && rect.top < viewHeight) {
      pending.visible = true;
    }
    if (rect.top >= 0) {
      pending.above = false;
    }
  };

  const flush = (pending: Pending): void => {
    const text = clip(clean(pending.parts.join(' ')).replace(/\] ([.,;:!?])/g, ']$1'), 600);
    if (text === '') {
      return;
    }
    lines.push({
      text: pending.prefix + text,
      visible: pending.visible,
      above: pending.above,
      controls: pending.controls,
    });
  };

  const walk = (element: Element, pending: Pending): void => {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = clean(node.textContent);
        if (text === '') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        pending.parts.push(text);
        place(pending, rect);
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const child = node as Element;
      if (BLOCK_SKIP.has(child.tagName.toUpperCase()) || !isShown(child)) continue;

      if (child instanceof HTMLLabelElement && child.control !== null && isShown(child.control)) {
        const control = child.control;
        const controlRole = child.contains(control) ? roleOf(control) : null;
        if (controlRole === null) {
          continue;
        }

        const target = isBlock(child) ? fresh('') : pending;
        if (target !== pending) flush(pending);
        target.parts.push(token(control, controlRole));
        target.controls += 1;
        place(target, control.getBoundingClientRect());
        if (target !== pending) {
          flush(target);
          Object.assign(pending, fresh(pending.prefix));
        }
        continue;
      }

      const role = roleOf(child);
      if (role !== null) {
        pending.parts.push(token(child, role));
        pending.controls += 1;
        place(pending, child.getBoundingClientRect());
        continue;
      }

      if (child.tagName === 'IMG') {
        const alt = child.getAttribute('alt');
        if (alt !== '') {
          pending.parts.push(
            alt === null ? '[image with no description]' : `[image ${quote(clean(alt))}]`,
          );
          place(pending, child.getBoundingClientRect());
        }
        continue;
      }

      if (isBlock(child)) {
        flush(pending);
        Object.assign(pending, fresh(pending.prefix));
        const inner = fresh(prefixFor(child));
        walk(child, inner);
        flush(inner);
        continue;
      }

      walk(child, pending);
    }
  };

  const root = fresh('');
  walk(document.body, root);
  flush(root);

  return {
    title: document.title,
    url: location.href,
    viewport: { width: viewWidth, height: viewHeight },
    scrollY: Math.round(window.scrollY),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    lines,
    nextRef,
  };
}
