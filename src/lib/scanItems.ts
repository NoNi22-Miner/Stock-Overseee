// One camera read or typed block can name several items. Each line is graded on its own.
import { familyKey, mappedGradeId } from './grades';
import { rankItems, splitName, type Dictionary } from './recognize';
import type { Product } from './types';

export type ScanHit = {
  product: Product;
  /** The line this hit came from. */
  text: string;
  score: number;
  /** Grade the line assigned (a written grade, or a recognition entry). Null when it named none. */
  gradeId: string | null;
  learned?: boolean;
};

const MIN_SCORE = 0.58;

function linesOf(blocks: string[]) {
  const out: string[] = [];
  for (const block of blocks) {
    for (const line of block.split(/\n+/)) {
      const text = line.trim();
      if (text.length >= 2) out.push(text);
    }
  }
  return [...new Set(out)].slice(0, 24);
}

function hitFor(text: string, products: Product[], dict: Dictionary, learned: Map<string, string>): ScanHit | null {
  const exact = products.find((p) => p.is_active && p.barcode.trim().toLowerCase() === text.toLowerCase());
  const ranked = exact
    ? [{ product: exact, score: 1, learned: false as boolean | undefined }]
    : rankItems([text], products, dict, learned, 4);
  const best = ranked[0];
  if (!best || (!exact && !best.learned && best.score < MIN_SCORE)) return null;
  const parts = exact ? null : splitName(text, dict, true);
  const gradeId = !best.product.structured ? best.product.grade_id : parts ? mappedGradeId(parts, dict) : null;
  return { product: best.product, text, score: best.score, gradeId, learned: best.learned };
}

/** Up to five different items in one scan, in the order their lines were read. */
export function identifyScanItems(
  blocks: string[],
  products: Product[],
  dict: Dictionary,
  learned: Map<string, string>,
): ScanHit[] {
  const hits: ScanHit[] = [];
  const seen = new Set<string>();
  const push = (hit: ScanHit | null) => {
    if (!hit || hits.length >= 5) return;
    const key = `${familyKey(hit.product)}|${hit.gradeId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };
  const lines = linesOf(blocks);
  for (const line of lines) push(hitFor(line, products, dict, learned));
  if (!hits.length) {
    const joined = blocks.map((b) => b.trim()).filter(Boolean).join('\n');
    const ranked = rankItems(blocks, products, dict, learned, 12);
    for (const match of ranked) {
      if (hits.length >= 5) break;
      const key = `${familyKey(match.product)}|${match.product.grade_id ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = splitName(match.learned ? joined : lines[0] || joined, dict, true);
      hits.push({
        product: match.product,
        text: joined,
        score: match.score,
        gradeId: match.product.structured ? mappedGradeId(parts, dict) : match.product.grade_id,
        learned: match.learned,
      });
    }
  }
  return hits;
}
