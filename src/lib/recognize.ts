// The Recognition Table reader (docs/RECOGNITION.md).
// Splits an item name, a line read from a Delivery Order, or typed text into parts:
//   Category · Grade · Labels · Size · Brand · Marks
// and ranks items by how many parts agree. Runs on the phone, so it also works offline.
import { scoreText } from './match';
import type { Category, Product, SizeBox, Term, TermKind } from './types';

// Units -----------------------------------------------------------------------------------------

export const UNITS = ['Lembar', 'Batang', 'Pcs', 'Roll', 'Dus', 'KG'] as const;
export type Unit = (typeof UNITS)[number];
/** Only KG takes decimals; Lembar, Batang, Pcs, Roll and Dus are counted in whole numbers. */
export const allowsDecimals = (unit: string) => unit.trim().toUpperCase() === 'KG';

// Text helpers ------------------------------------------------------------------------------------

/** Upper case, one kind of quote, × as X, single spaces. */
export function cleanText(s: string) {
  return s
    .toUpperCase()
    .replace(/[“”″‟]/g, '"')
    .replace(/[‘’′`´]/g, "'")
    .replace(/[×✕]/g, 'X')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Common OCR confusions (O/0, I/L/1, S/5, B/8), one character for one, so positions stay the same. */
const FOLD: Record<string, string> = { O: '0', I: '1', L: '1', '|': '1', S: '5', B: '8' };
const foldText = (s: string) => s.replace(/[OIL|SB]/g, (c) => FOLD[c]);

const WORD = /[A-Z0-9/-]/;
const isAlnum = (c: string) => /[A-Z0-9]/.test(c);

/** Finds `needle` in `hay` as a whole word (spellings that start or end with a symbol skip that check). */
function findWord(hay: string, needle: string, from = 0): number {
  const checkBefore = isAlnum(needle[0]);
  const checkAfter = isAlnum(needle[needle.length - 1]);
  let i = hay.indexOf(needle, from);
  while (i >= 0) {
    const before = i === 0 ? ' ' : hay[i - 1];
    const after = i + needle.length >= hay.length ? ' ' : hay[i + needle.length];
    if ((!checkBefore || !WORD.test(before)) && (!checkAfter || !WORD.test(after))) return i;
    i = hay.indexOf(needle, i + 1);
  }
  return -1;
}

const blank = (s: string, start: number, len: number) => s.slice(0, start) + ' '.repeat(len) + s.slice(start + len);

// Dictionary ---------------------------------------------------------------------------------

type Spelling = { text: string; folded: string; id: string };
export type Dictionary = {
  categories: Spelling[];
  terms: Record<TermKind, Spelling[]>;
  categoryById: Map<string, Category>;
  termById: Map<string, Term>;
};

function spellings(id: string, name: string, aliases: string[] | null | undefined): Spelling[] {
  return [name, ...(aliases ?? [])]
    .map((s) => cleanText(s))
    .filter(Boolean)
    .map((text) => ({ text, folded: foldText(text), id }));
}
const longestFirst = (a: Spelling, b: Spelling) => b.text.length - a.text.length;

export function buildDictionary(categories: Category[], terms: Term[]): Dictionary {
  const byKind: Record<TermKind, Spelling[]> = { grade: [], label: [], brand: [], mark: [] };
  for (const t of terms) byKind[t.kind].push(...spellings(t.id, t.name, t.aliases));
  for (const k of Object.keys(byKind) as TermKind[]) byKind[k].sort(longestFirst);
  return {
    categories: categories.flatMap((c) => spellings(c.id, c.name, c.aliases)).sort(longestFirst),
    terms: byKind,
    categoryById: new Map(categories.map((c) => [c.id, c])),
    termById: new Map(terms.map((t) => [t.id, t])),
  };
}

// Sizes --------------------------------------------------------------------------------------------

const NUM = String.raw`(?:\d+ \d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?:-\d+(?:\.\d+)?)?`;
const UNIT_RE = String.raw`(?:MM|CM|M|DEG|KG|L|"|')`;
const BRACKET = String.raw`(?: ?\( ?\d+(?:\.\d+)? ?MM ?\))?`;
const MEAS = String.raw`${NUM}(?: ?${UNIT_RE})?${BRACKET}`;
const MEAS_UNIT = String.raw`${NUM} ?${UNIT_RE}${BRACKET}`;
// Values joined by X; a value after a space only when it has a unit or an X follows
// ("BWG 21 20KG", "12MM 4'X8'"), so a quantity like "20 BTG" is not read as size.
const SIZE_RE = new RegExp(
  String.raw`(?:BWG )?${MEAS}(?: ?X ?${MEAS}| +${MEAS_UNIT}(?=\s|$|X)| +${MEAS}(?= ?X))*`,
  'g',
);
const MEAS_RE = new RegExp(MEAS, 'g');

const UNIT_TEXT: Record<string, string> = { MM: 'mm', CM: 'cm', M: 'm', KG: 'kg', L: 'L', DEG: '°' };

/** '1 1/2" (44.5MM)X1.6MMX6M' -> ['1 1/2" (44.5mm)', '1.6mm', '6m'] */
export function formatSize(raw: string): string[] {
  let rest = raw;
  const out: string[] = [];
  const gauge = /^BWG (\d+) ?/.exec(rest);
  if (gauge) {
    out.push(`BWG ${gauge[1]}`);
    rest = rest.slice(gauge[0].length);
  }
  for (const m of rest.match(MEAS_RE) ?? []) {
    out.push(
      m
        .trim()
        .replace(/ ?\( ?([\d.]+) ?MM ?\)/, ' ($1mm)')
        .replace(/(\d) ?(MM|CM|M|DEG|KG|L)\b/g, (_, d: string, u: string) => d + UNIT_TEXT[u]),
    );
  }
  return out.filter(Boolean);
}

/** '1 1/2"' -> 1.5, '600-635cm' -> [600, 635], '2" (56mm)' -> [2, 56]. */
export function sizeNumbers(size: string[]): number[] {
  const out: number[] = [];
  for (const box of size) {
    const re = /(\d+) (\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(box))) {
      if (m[1]) out.push(Number(m[1]) + Number(m[2]) / Number(m[3]));
      else if (m[4]) out.push(Number(m[4]) / Number(m[5]));
      else out.push(Number(m[6]));
    }
  }
  return out;
}

/** The unit written after a size value: 'mm', 'm', '"', "'", 'kg', ... ('' when there is none). */
export const sizeUnit = (box: string) =>
  /(mm|cm|m|kg|l|°|"|')\)?$/i.exec(box.replace(/ ?\([^)]*\)$/, ''))?.[1]?.toLowerCase() ?? '';

/**
 * Sizes agree when every number read is in the item's size, in order, starting with the first
 * (main) one. Missing numbers (a length left out, an OD in brackets) don't count against it.
 */
export function sizeAgrees(read: number[], item: number[]) {
  if (!read.length) return true;
  if (!item.length || Math.abs(read[0] - item[0]) > 1e-6) return false;
  let j = 1;
  for (let i = 1; i < read.length; i++) {
    while (j < item.length && Math.abs(item[j] - read[i]) > 1e-6) j++;
    if (j >= item.length) return false;
    j++;
  }
  return true;
}

/**
 * Fills a box left out with its default, e.g. CNP BESI 100X50X20X2.3MM -> length 6m.
 * Only when the last value read is not already that kind of value (a length in m stays as it is).
 */
export function applySizeDefaults(size: string[], pattern: Category['size_pattern']): string[] {
  const last = pattern[pattern.length - 1];
  if (!last?.default || !size.length || size.length >= pattern.length) return size;
  if (sizeUnit(size[size.length - 1]) === sizeUnit(last.default)) return size;
  return [...size, last.default];
}

// Splitting a name --------------------------------------------------------------------------------

export type Parts = {
  categoryId: string | null;
  gradeId: string | null;
  labelIds: string[];
  brandId: string | null;
  markIds: string[];
  size: string[];
  /** Words that are not in the Recognition Table. */
  unknown: string[];
  /** More than one brand was found (only the first is used). */
  extraBrands: string[];
  /** Something that looks like part of a size was not understood (e.g. `2 L/2"`). */
  sizeDoubt: boolean;
};

/**
 * Reads the parts of a name. `fuzzy` also accepts common OCR mistakes (for camera text);
 * the Excel import uses the exact spellings.
 */
export function splitName(input: string, dict: Dictionary, fuzzy = false): Parts {
  let text = ` ${cleanText(input)} `;
  if (fuzzy) {
    // OCR: letter O / I / L next to digits is a digit (1OMM -> 10MM).
    for (let k = 0; k < 2; k++) {
      text = text
        .replace(/(\d)O/g, '$10')
        .replace(/O(\d)/g, '0$1')
        .replace(/(\d)[IL]/g, '$11')
        .replace(/(^|[ X(])[IL](\d)/g, '$11$2')
        .replace(/(^|[ X])[IL] (\d+\/\d+)/g, '$11 $2')
        .replace(/(^|[ X(\d])[IL](?=\/\d|["'])/g, '$11')
        .replace(/(\d\/)[IL]/g, '$11')
        .replace(/(^|[ X(])[IL](?=[O0]\d*(?:MM|M|CM|"|'|X)|\.\d|MM|CM|["'])/g, '$11')
        .replace(/(^|[ X(])O(?=\.\d)/g, '$10');
    }
  }
  let folded = foldText(text);

  /** Longest spellings first; the ids come back in the order they appear in the text. */
  const take = (list: Spelling[], many: boolean): string[] => {
    const found: { id: string; at: number }[] = [];
    for (const s of list) {
      // OCR mix-ups are allowed for spellings of 3+ characters, and for 2 when a letter is left
      // (AS ~ A5); single characters must match exactly, so "S" never matches a "5".
      const useFold = fuzzy && (s.text.length >= 3 || (s.text.length === 2 && /[A-Z]/.test(s.folded)));
      const at = useFold ? findWord(folded, s.folded) : findWord(text, s.text);
      if (at < 0) continue;
      text = blank(text, at, s.text.length);
      folded = blank(folded, at, s.text.length);
      if (!found.some((f) => f.id === s.id)) found.push({ id: s.id, at });
      if (!many) break;
    }
    return found.sort((a, b) => a.at - b.at).map((f) => f.id);
  };

  const categoryId = take(dict.categories, false)[0] ?? null;
  const markIds = take(dict.terms.mark, true);
  const labelIds = take(dict.terms.label, true);
  const gradeId = take(dict.terms.grade, false)[0] ?? null;
  const brands = take(dict.terms.brand, true);

  // The size is the best-looking number group: most values, then with units ("1." or "10 BTG" lose).
  let size: string[] = [];
  let best: { at: number; len: number; rank: number } | null = null;
  SIZE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SIZE_RE.exec(text))) {
    const before = m.index === 0 ? ' ' : text[m.index - 1];
    if (WORD.test(before) || !m[0].trim()) {
      SIZE_RE.lastIndex = m.index + 1; // try again from the next character
      continue;
    }
    let at = m.index;
    let raw = m[0];
    // A lone number before a size ("5 4\"X6M", where the 5 is a misread S) is not part of it.
    const lone = /^\d+(?:\.\d+)? +(?!\d+\/\d+)(?=\d)/.exec(raw);
    if (lone) {
      at += lone[0].length;
      raw = raw.slice(lone[0].length);
    }
    const values = formatSize(raw.trim());
    const rank = values.length * 2 + (values.some((v) => /[a-z"'°L]/.test(v)) ? 1 : 0);
    if (!best || rank > best.rank) {
      best = { at, len: raw.length, rank };
      size = values;
    }
  }
  if (best) text = blank(text, best.at, best.len);

  const unknown = text
    .split(' ')
    .map((w) => w.replace(/^[^A-Z0-9*]+|[^A-Z0-9*]+$/g, ''))
    .filter(Boolean);
  return {
    categoryId,
    gradeId,
    labelIds: labelIds.slice(0, 3),
    brandId: brands[0] ?? null,
    markIds: markIds.slice(0, 3),
    size,
    unknown,
    extraBrands: brands.slice(1),
    sizeDoubt: unknown.some((w) => /\d/.test(w) && /[/"'X]|\d(MM|CM|M)\b/.test(w)),
  };
}

// The item name (same rule as private.product_name in the database) ----------------------------

export type ItemParts = {
  category_id: string | null;
  grade_id: string | null;
  label_ids: string[];
  brand_id: string | null;
  mark_ids: string[];
  size: string[];
};

/** The name from part names: "Category Grade · Labels · Size · Brand Marks" (symbol marks stick: VM*). */
export function nameFromText(p: {
  category: string;
  grade?: string | null;
  labels: string[];
  size: string[];
  brand?: string | null;
  marks: string[];
}): string {
  const parts = [[p.category, p.grade].filter(Boolean).join(' ')];
  const labels = p.labels.filter(Boolean).join(' ');
  if (labels) parts.push(labels);
  const size = p.size.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (size.length) parts.push(size.join(' × '));
  const marks = p.marks
    .filter(Boolean)
    .map((m) => (/[A-Za-z0-9]/.test(m) ? ` ${m}` : m))
    .join('');
  const last = ((p.brand ?? '') + marks).trim();
  if (last) parts.push(last);
  return parts.join(' · ');
}

/** The same name the database builds (private.product_name). */
export function buildName(p: ItemParts, dict: Dictionary): string {
  const name = (id: string | null) => (id ? (dict.termById.get(id)?.name ?? '') : '');
  return nameFromText({
    category: p.category_id ? (dict.categoryById.get(p.category_id)?.name ?? '') : '',
    grade: name(p.grade_id),
    labels: p.label_ids.map(name),
    size: p.size,
    brand: name(p.brand_id),
    marks: p.mark_ids.map(name),
  });
}

/** The list entry a spelling stands for (exact, any case), e.g. "STD (A)" -> grade A. */
export function findTerm(dict: Dictionary, kind: TermKind, text: string): Term | null {
  const t = cleanText(text);
  if (!t) return null;
  const s = dict.terms[kind].find((x) => x.text === t);
  return s ? (dict.termById.get(s.id) ?? null) : null;
}

export function findCategory(dict: Dictionary, text: string): Category | null {
  const t = cleanText(text);
  if (!t) return null;
  const s = dict.categories.find((x) => x.text === t);
  return s ? (dict.categoryById.get(s.id) ?? null) : null;
}

// Ranking items for a scan ---------------------------------------------------------------------

export type PartCheck = 'match' | 'differs' | 'unread';
export type ItemMatch = {
  product: Product;
  /** 0..1 */
  score: number;
  /** Per part: did the text agree with the item? (structured items only) */
  checks?: Partial<Record<'category' | 'grade' | 'label' | 'size' | 'brand' | 'mark', PartCheck>>;
  sizeDiffers?: boolean;
  /** Picked straight away because someone picked this item for the same text before. */
  learned?: boolean;
};

const W = { category: 3, size: 3, brand: 2, label: 1.5, grade: 1, mark: 1.5 };

function scoreParts(read: Parts, p: Product): Omit<ItemMatch, 'product'> {
  let got = 0;
  let total = 0;
  const checks: NonNullable<ItemMatch['checks']> = {};
  const one = (key: 'category' | 'grade' | 'brand', r: string | null, i: string | null, unread: number) => {
    if (r) {
      total += W[key];
      if (r === i) got += W[key];
      checks[key] = r === i ? 'match' : 'differs';
    } else if (i) {
      total += unread;
      checks[key] = 'unread';
    }
  };
  one('category', read.categoryId, p.category_id, 0.3);
  one('grade', read.gradeId, p.grade_id, 0.3);
  one('brand', read.brandId, p.brand_id, 0.5);

  const many = (key: 'label' | 'mark', r: string[], i: string[], unread: number) => {
    let differs = false;
    let matched = false;
    for (const id of new Set([...r, ...i])) {
      const inR = r.includes(id);
      const inI = i.includes(id);
      if (inR) total += W[key];
      if (inR && inI) {
        got += W[key];
        matched = true;
      } else if (inR) differs = true;
      else total += unread;
    }
    if (r.length || i.length) checks[key] = differs ? 'differs' : matched ? 'match' : 'unread';
  };
  many('label', read.labelIds, p.label_ids ?? [], 0.5);
  // A mark that was not read counts more, so "VM" ranks above "VM*" when no * is on the paper.
  many('mark', read.markIds, p.mark_ids ?? [], 0.6);

  let sizeDiffers = false;
  const rn = sizeNumbers(read.size);
  // Items without a size (e.g. BARANG BAN BEKAS) are not judged on numbers.
  if (rn.length && p.size?.length) {
    total += W.size;
    if (sizeAgrees(rn, sizeNumbers(p.size ?? []))) {
      got += W.size;
      checks.size = 'match';
    } else {
      sizeDiffers = true;
      checks.size = 'differs';
    }
  } else if (p.size?.length) {
    total += 0.3;
    checks.size = 'unread';
  }

  let score = total ? got / total : 0;
  // A different size is never a sure match, and neither is a size that was only partly understood.
  if (sizeDiffers) score = Math.min(score * 0.6, 0.55);
  else if (read.sizeDoubt) score = Math.min(score, 0.79);
  return { score, checks, sizeDiffers };
}

/** Text pieces worth trying: each block, each line, and everything together. */
function candidates(blocks: string[]) {
  const parts = blocks.map((b) => b.trim()).filter(Boolean);
  const all = [...parts, ...parts.flatMap((p) => p.split(/\n+/)), parts.join(' ')];
  return [...new Set(all.map((s) => s.trim()))].filter((s) => s.length >= 2);
}

/** The key a learned spelling is saved under (keeps symbols, so VM and VM(*) stay apart). */
export const spellingKey = (text: string) => cleanText(text);

/**
 * Items ranked by how well they fit the text (camera words or typed).
 * `learned`: spellings saved earlier (spelling key -> product id).
 */
export function rankItems(
  blocks: string[],
  products: Product[],
  dict: Dictionary,
  learned: Map<string, string> = new Map(),
  limit = 6,
): ItemMatch[] {
  const texts = candidates(blocks);
  if (!texts.length) return [];
  const active = products.filter((p) => p.is_active);

  for (const t of texts) {
    const id = learned.get(spellingKey(t));
    const hit = id && active.find((p) => p.id === id);
    if (hit) return [{ product: hit, score: 1, learned: true }];
  }

  const reads = texts.map((t) => splitName(t, dict, true));
  // Only texts where at least two parts were found are compared part by part.
  const useful = reads.filter(
    (r) =>
      [r.categoryId, r.gradeId, r.brandId, r.size.length ? 'size' : null].filter(Boolean).length +
        r.labelIds.length +
        r.markIds.length >=
      2,
  );

  const best = new Map<string, ItemMatch>();
  for (const product of active) {
    let top: ItemMatch = { product, score: 0 };
    if (product.structured) {
      for (const r of useful) {
        const s = scoreParts(r, product);
        if (s.score > top.score) top = { product, ...s };
      }
    }
    // Plain-name comparison: for items not split into parts yet, or when no parts were read.
    if (!product.structured || !useful.length) {
      const plain = Math.max(0, ...texts.map((t) => scoreText(t, product)));
      if (plain > top.score) top = { product, score: plain };
    }
    if (top.score >= 0.35) best.set(product.id, top);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, limit);
}

/** True when the best match is clearly the one (high score, well ahead of the next). */
export function isSure(matches: ItemMatch[]) {
  if (!matches.length) return false;
  const [first, second] = matches;
  if (first.learned) return true;
  if (first.sizeDiffers) return false;
  return first.score >= 0.8 && (!second || first.score - second.score >= 0.12);
}

// Size boxes in the item form ------------------------------------------------------------------

/** "Tebal (mm) × Lebar (') × Panjang (') [6m]" */
export function patternText(p: SizeBox[]) {
  if (!p.length) return 'No size pattern';
  return p
    .map((b) => `${b.name}${b.unit ? ` (${b.unit})` : ''}${b.optional ? '?' : ''}${b.default ? ` [${b.default}]` : ''}`)
    .join(' × ');
}

const BARE_NUMBER = /^(?:\d+ \d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)(?:-\d+(?:[.,]\d+)?)?$/;

/** "6" in a box with unit m -> "6m"; values with their own unit are kept as typed. */
export function withBoxUnit(value: string, box?: SizeBox) {
  const v = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2');
  if (!v || !box?.unit || !BARE_NUMBER.test(v)) return v;
  return v + box.unit;
}

/**
 * The size to save from the form boxes: units added, empty boxes with a default filled, other
 * empty optional boxes dropped. `missing` names required boxes left empty.
 */
export function finishSize(values: string[], pattern: SizeBox[]): { size: string[]; missing: string[] } {
  if (!pattern.length) return { size: values.map((v) => v.trim()).filter(Boolean), missing: [] };
  const size: string[] = [];
  const missing: string[] = [];
  pattern.forEach((box, i) => {
    const v = withBoxUnit(values[i] ?? '', box) || (box.default ?? '');
    if (v) size.push(v);
    else if (!box.optional) missing.push(box.name);
  });
  return { size, missing };
}

/**
 * Places a saved size into the category's boxes (optional / default boxes can be skipped), or
 * null when it does not follow the pattern. Saving the result unchanged gives the same size back.
 */
export function fitToPattern(size: string[], pattern: SizeBox[]): string[] | null {
  const values = size.map((v) => v.trim()).filter(Boolean);
  if (!pattern.length || values.length > pattern.length) return null;
  const out: string[] = Array(pattern.length).fill('');
  let j = 0;
  for (let k = 0; k < values.length; k++) {
    while (j < pattern.length) {
      const box = pattern[j];
      const spare = pattern.length - j > values.length - k;
      if (spare && (box.optional || box.default) && box.unit && sizeUnit(values[k]) !== box.unit.toLowerCase()) {
        j++;
        continue;
      }
      break;
    }
    if (j >= pattern.length) return null;
    out[j++] = values[k];
  }
  const back = finishSize(out, pattern).size;
  return back.length === values.length && back.every((v, i) => v === values[i]) ? out : null;
}
