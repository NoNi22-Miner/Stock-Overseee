// "Closest product" matching for words read from a label (OCR) or typed by hand.
// Tolerates OCR mistakes, extra words, different order and missing words.
import type { Product } from './types';

export type ProductMatch = { product: Product; score: number }; // score 0..1

/** Lower-case, unify quotes, keep letters / digits / fraction marks, single spaces. */
export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[“”″‟]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[^a-z0-9/".,' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s: string) => normalize(s).split(' ').filter(Boolean);

/** Common OCR confusions, applied to both sides so "0"/"O", "1"/"I"/"l", "5"/"S" compare equal. */
const fold = (s: string) => s.replace(/o/g, '0').replace(/[il|]/g, '1').replace(/s/g, '5').replace(/b/g, '8');

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');

/**
 * 0..1, 1 = identical (after OCR folding). Sizes must agree: when both words contain numbers,
 * the numbers decide ("30mm" ≠ "20mm", "1/2" ≠ "3/4", but "90deg" ≈ "90").
 */
function wordSimilarity(a: string, b: string) {
  const fa = fold(a.replace(/["']/g, ''));
  const fb = fold(b.replace(/["']/g, ''));
  if (fa === fb) return 1;
  const len = Math.max(fa.length, fb.length);
  const plain = len ? 1 - levenshtein(fa, fb) / len : 0;
  // Sizes are compared on the real digits (folding would turn the "i" in "pipe" into a "1").
  const da = digits(a);
  const db = digits(b);
  if (da && db) return da === db ? Math.max(plain, 0.85) : 0;
  return plain;
}

/** Character-bigram overlap of two strings (Dice coefficient). */
function dice(a: string, b: string) {
  const grams = (s: string) => {
    const t = fold(s.replace(/ /g, ''));
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

/** How well the text covers the product name: each name word is matched to its closest text word. */
function coverage(textTokens: string[], nameTokens: string[]) {
  if (!nameTokens.length || !textTokens.length) return 0;
  let weighted = 0;
  let weights = 0;
  for (const nt of nameTokens) {
    const w = Math.max(1, nt.length);
    let best = 0;
    for (const tt of textTokens) {
      const sim = wordSimilarity(nt, tt);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    weighted += (best >= 0.6 ? best : 0) * w;
    weights += w;
  }
  return weighted / weights;
}

/** 0..1: how well the text fits the product's name or code. */
export function scoreText(text: string, product: Pick<Product, 'name' | 'barcode'>) {
  const t = normalize(text);
  if (!t) return 0;
  const textTokens = t.split(' ');
  // The product code / barcode printed anywhere on the label is a sure match.
  const code = fold(normalize(product.barcode).replace(/[ .,'"]/g, ''));
  if (code.length >= 3 && fold(t.replace(/[ .,'"]/g, '')).includes(code)) return 1;
  const name = normalize(product.name);
  if (!name) return 0;
  if (t === name) return 1;
  const cov = coverage(textTokens, name.split(' '));
  const d = dice(t, name);
  return Math.min(1, Math.max(cov * 0.75 + d * 0.25, d));
}

/**
 * Products ranked by how closely they match the given text blocks (e.g. OCR lines).
 * Each block and all blocks together are compared; the best score counts.
 */
export function matchProducts(blocks: string[], products: Product[], limit = 5): ProductMatch[] {
  const parts = blocks.map((b) => b.trim()).filter(Boolean);
  if (!parts.length) return [];
  const candidates = [...parts, ...parts.flatMap((p) => p.split(/\n+/)), parts.join(' ')];
  const unique = [...new Set(candidates.map(normalize))].filter((c) => c.length >= 2);
  return products
    .filter((p) => p.is_active)
    .map((product) => ({ product, score: Math.max(0, ...unique.map((c) => scoreText(c, product))) }))
    .filter((m) => m.score >= 0.35)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, limit);
}

/** True when the best match is clearly the one (high score, well ahead of the next). */
export function isConfident(matches: ProductMatch[]) {
  if (!matches.length) return false;
  const [first, second] = matches;
  return first.score >= 0.8 && (!second || first.score - second.score >= 0.12);
}
