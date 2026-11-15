const RATES = { none: 0, low: 0.02, medium: 0.05, high: 0.1 } as const;

export type TypoRate = keyof typeof RATES;

const NEIGHBOURS: Record<string, string> = {
  q: 'wa',
  w: 'qes',
  e: 'wrd',
  r: 'etf',
  t: 'ryg',
  y: 'tuh',
  u: 'yij',
  i: 'uok',
  o: 'ipl',
  p: 'ol',
  a: 'qsz',
  s: 'adwx',
  d: 'sfec',
  f: 'dgrv',
  g: 'fhtb',
  h: 'gjyn',
  j: 'hkum',
  k: 'jli',
  l: 'kop',
  z: 'asx',
  x: 'zcs',
  c: 'xvd',
  v: 'cbf',
  b: 'vng',
  n: 'bmh',
  m: 'nj',
};

/** Small deterministic generator so a session's typos are reproducible from its id. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }

  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

/** Swaps letters for a neighbouring key at the persona's rate. Digits and symbols are left alone. */
export function addTypos(text: string, rate: TypoRate | undefined, random: () => number): string {
  const chance = RATES[rate ?? 'none'];
  if (chance === 0) {
    return text;
  }

  return [...text]
    .map((char) => {
      const lower = char.toLowerCase();
      const options = NEIGHBOURS[lower];
      if (options === undefined || random() >= chance) {
        return char;
      }
      const swap = options[Math.floor(random() * options.length)] ?? lower;
      return char === lower ? swap : swap.toUpperCase();
    })
    .join('');
}
