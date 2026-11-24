// Grade per move: one item, its stock kept per grade.
// The grade versions of an item are the items with the same parts except the grade. A move can pick
// any grade from the Recognition Table; a version that does not exist yet is made by the database
// the first time it is used (record_graded_movement / record_graded_adjustment).
//
// The team's standard grade (B until someone changes it) is what a new item uses. A category, label,
// brand or mark can assign another grade; a grade written in the name wins over that. The person can
// still pick a different grade. A grade other than the standard one can carry a remark.
import { buildName, findTerm, type Dictionary, type Parts } from './recognize';
import type { Product, Term } from './types';

/** Items with the same key are grade versions of each other. Items not split into parts stand alone. */
export function familyKey(p: Product): string {
  if (!p.structured) return `id:${p.id}`;
  return [
    p.category_id ?? '',
    (p.label_ids ?? []).join(','),
    (p.size ?? []).join('×').toUpperCase(),
    p.brand_id ?? '',
    (p.mark_ids ?? []).join(','),
  ].join('|');
}

/** Every version of this item (itself included), "no grade" first, then A, B, C … */
export function gradeVersions(products: Product[], p: Product, dict: Dictionary): Product[] {
  const key = familyKey(p);
  const list = p.structured ? products.filter((x) => x.id === p.id || familyKey(x) === key) : [p];
  if (!list.some((x) => x.id === p.id)) list.push(p);
  return list.sort((a, b) => gradeOrder(a.grade_id, dict) - gradeOrder(b.grade_id, dict));
}

/** Sort order of grades: no grade first, then by name (A, B, C …). */
export function gradeOrder(id: string | null, dict: Dictionary) {
  if (!id) return -1;
  const names = [...dict.termById.values()]
    .filter((t) => t.kind === 'grade')
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const i = names.indexOf(dict.termById.get(id)?.name ?? '');
  return i < 0 ? 999 : i;
}

/** The grades in the Recognition Table, in name order (A, B, C …). */
export function gradeList(terms: Term[]): Term[] {
  return terms
    .filter((t) => t.kind === 'grade')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export const gradeName = (id: string | null, dict: Dictionary) =>
  id ? (dict.termById.get(id)?.name ?? '?') : 'No grade';

/** Short label for a list of versions: "A", "B" … and "None" for no grade. */
export const gradeShort = (id: string | null, dict: Dictionary) => (id ? (dict.termById.get(id)?.name ?? '?') : 'None');

/** The item's name without its grade (the name all its versions share). */
export function familyName(p: Product, dict: Dictionary): string {
  if (!p.structured || !p.grade_id || !p.category_id || !dict.categoryById.has(p.category_id)) return p.name;
  return buildName({ ...p, grade_id: null }, dict) || p.name;
}

/** The name the version with this grade has (or will get). */
export function versionName(p: Product, gradeId: string | null, dict: Dictionary): string {
  if (!p.structured || p.grade_id === gradeId || !p.category_id || !dict.categoryById.has(p.category_id)) return p.name;
  return buildName({ ...p, grade_id: gradeId }, dict) || p.name;
}

/**
 * The grade new items use. `configuredId` is teams.default_grade_id; when it is empty, the grade
 * named B is used, then the first grade in the list.
 */
export function defaultGradeTerm(terms: Term[], configuredId: string | null | undefined): Term | null {
  const grades = gradeList(terms);
  if (!grades.length) return null;
  if (configuredId) {
    const chosen = grades.find((g) => g.id === configuredId);
    if (chosen) return chosen;
  }
  return grades.find((g) => g.name.toUpperCase() === 'B') ?? grades[0];
}

/** Grade id a recognition entry assigns, if it assigns one. */
function entryGrade(dict: Dictionary, id: string | null | undefined): string | null {
  if (!id) return null;
  return dict.termById.get(id)?.target_grade_id ?? dict.categoryById.get(id)?.target_grade_id ?? null;
}

/**
 * Grade read from a name: the grade written in it, otherwise the grade a matched mark, label, brand
 * or category assigns. Null when the name leaves the grade to the standard one.
 */
export function mappedGradeId(parts: Parts, dict: Dictionary): string | null {
  if (parts.gradeId) return parts.gradeId;
  for (const id of parts.markIds) {
    const g = entryGrade(dict, id);
    if (g) return g;
  }
  for (const id of parts.labelIds) {
    const g = entryGrade(dict, id);
    if (g) return g;
  }
  const brand = entryGrade(dict, parts.brandId);
  if (brand) return brand;
  return entryGrade(dict, parts.categoryId);
}

/**
 * Grade to store for an imported row. A grade typed in the file wins. Otherwise the same rule as
 * {@link mappedGradeId}, then the standard grade's name (null when the team has no grades).
 */
export function importGradeName(
  dict: Dictionary,
  parts: Parts,
  standardName: string | null,
  explicitText = '',
): string | null {
  const typed = explicitText.trim();
  if (typed) return findTerm(dict, 'grade', typed)?.name ?? typed;
  const id = mappedGradeId(parts, dict);
  if (id) return dict.termById.get(id)?.name ?? standardName;
  return standardName;
}
