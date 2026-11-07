// Excel item import: turns sheet rows into items and checks them before anything is saved.
// Two layouts are accepted:
//  - plain names, one per row (like the DO system's item list): split with the Recognition Table
//  - the template: Category · Grade · Label 1-3 · Size 1-5 · Brand · Mark · Unit · Min stock · Code
import type { ImportItem } from './api';
import {
  applySizeDefaults,
  cleanText,
  findCategory,
  findTerm,
  nameFromText,
  splitName,
  UNITS,
  type Dictionary,
} from './recognize';
import type { Product, TermKind } from './types';

export const TEMPLATE_HEADER = [
  'Category',
  'Grade',
  'Label 1',
  'Label 2',
  'Label 3',
  'Size 1',
  'Size 2',
  'Size 3',
  'Size 4',
  'Size 5',
  'Brand',
  'Mark',
  'Unit',
  'Min stock',
  'Code',
];

export const TEMPLATE_EXAMPLE = [
  'PLAT BESI',
  '',
  'SS400',
  '',
  '',
  '10mm',
  "4'",
  "8'",
  '',
  '',
  'KP',
  '',
  'Lembar',
  '5',
  '',
];

export type ImportStatus = 'new' | 'exists' | 'repeat' | 'problem';

export type ImportRow = {
  /** Row number in the sheet (1 = first row). */
  row: number;
  source: string;
  status: ImportStatus;
  name?: string;
  item?: ImportItem;
  problem?: string;
};

export type ImportCheck = {
  layout: 'names' | 'template';
  rows: ImportRow[];
  /** List entries the import will add (template layout), e.g. "Brand: KP". */
  newEntries: string[];
};

const NAME_HEADERS = ['name', 'item', 'item name', 'nama', 'nama barang', 'barang', 'description', 'deskripsi'];

const unitOf = (text: string) => UNITS.find((u) => u.toUpperCase() === cleanText(text)) ?? null;

export function checkImport(sheet: string[][], dict: Dictionary, products: Product[]): ImportCheck {
  const rows = sheet.map((r) => r.map((c) => (c ?? '').toString().trim()));
  const firstIdx = rows.findIndex((r) => r.some(Boolean));
  const header = (rows[firstIdx] ?? []).map((c) => c.toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());

  const existing = new Set(products.filter((p) => p.structured).map((p) => p.name.toUpperCase()));
  const inFile = new Map<string, number>();
  const newEntries = new Set<string>();
  const out: ImportRow[] = [];

  const finish = (r: ImportRow) => {
    if (r.status === 'new' && r.name) {
      const key = r.name.toUpperCase();
      if (existing.has(key)) r.status = 'exists';
      else if (inFile.has(key)) {
        r.status = 'repeat';
        r.problem = `Same as row ${inFile.get(key)}`;
      } else inFile.set(key, r.row);
    }
    out.push(r);
  };

  // Template layout ---------------------------------------------------------------------------------
  if (col('category') >= 0) {
    const idx = {
      category: col('category'),
      grade: col('grade'),
      labels: [col('label 1'), col('label 2'), col('label 3'), col('label')].filter((i) => i >= 0),
      size: [col('size 1'), col('size 2'), col('size 3'), col('size 4'), col('size 5'), col('size')].filter(
        (i) => i >= 0,
      ),
      brand: col('brand'),
      mark: col('mark'),
      unit: col('unit'),
      min: col('min stock'),
      code: col('code'),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '') : '');
    /** The list's own spelling, or the text as a new entry. */
    const canon = (kind: TermKind, text: string, label: string) => {
      const t = cleanText(text);
      if (!t) return '';
      const found = findTerm(dict, kind, t);
      if (!found) newEntries.add(`${label}: ${t}`);
      return found?.name ?? t;
    };

    rows.forEach((r, i) => {
      if (i <= firstIdx || !r.some(Boolean)) return;
      const source = r.filter(Boolean).join(' | ');
      const catText = cleanText(get(r, idx.category));
      if (!catText) return finish({ row: i + 1, source, status: 'problem', problem: 'No category' });
      const cat = findCategory(dict, catText);
      if (!cat) newEntries.add(`Category: ${catText}`);
      const unitText = get(r, idx.unit);
      const unit = unitText ? unitOf(unitText) : (cat?.default_unit ?? null);
      if (!unit) {
        return finish({
          row: i + 1,
          source,
          status: 'problem',
          problem: unitText ? `Unit "${unitText}": use ${UNITS.join(', ')}` : 'No unit',
        });
      }
      const min = Number(get(r, idx.min).replace(',', '.') || 0);
      const item: ImportItem = {
        category: cat?.name ?? catText,
        grade: canon('grade', get(r, idx.grade), 'Grade') || null,
        labels: idx.labels
          .map((c) => canon('label', get(r, c), 'Label'))
          .filter(Boolean)
          .slice(0, 3),
        size: idx.size
          .map((c) => get(r, c))
          .filter(Boolean)
          .slice(0, 5),
        brand: canon('brand', get(r, idx.brand), 'Brand') || null,
        marks: get(r, idx.mark)
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((m) => canon('mark', m, 'Mark'))
          .slice(0, 3),
        unit,
        min_stock: Number.isFinite(min) && min > 0 ? min : 0,
        barcode: get(r, idx.code) || null,
      };
      if (cat) item.size = applySizeDefaults(item.size, cat.size_pattern);
      finish({ row: i + 1, source, status: 'new', item, name: nameFromText(item) });
    });
    return { layout: 'template', rows: out, newEntries: [...newEntries].sort() };
  }

  // Plain names -------------------------------------------------------------------------------------
  const nameCol = Math.max(0, NAME_HEADERS.map((h) => col(h)).find((i) => i >= 0) ?? -1);
  const hasHeader = NAME_HEADERS.some((h) => col(h) >= 0);
  rows.forEach((r, i) => {
    if (i < firstIdx || (hasHeader && i === firstIdx)) return;
    const source = (r[nameCol] || r.find(Boolean) || '').trim();
    if (!source) return;
    const parts = splitName(source, dict);
    const cat = parts.categoryId ? dict.categoryById.get(parts.categoryId) : undefined;
    let problem: string | undefined;
    if (!cat) problem = 'Category not in the Recognition Table';
    else if (parts.unknown.length) problem = `Not understood: ${parts.unknown.join(' ')}`;
    else if (parts.extraBrands.length) problem = 'More than one brand';
    if (!cat || problem) return finish({ row: i + 1, source, status: 'problem', problem });

    const term = (id: string | null) => (id ? (dict.termById.get(id)?.name ?? '') : '');
    const item: ImportItem = {
      category: cat.name,
      grade: term(parts.gradeId) || null,
      labels: parts.labelIds.map(term),
      size: applySizeDefaults(parts.size, cat.size_pattern),
      brand: term(parts.brandId) || null,
      marks: parts.markIds.map(term),
      unit: cat.default_unit,
      min_stock: 0,
    };
    finish({ row: i + 1, source, status: 'new', item, name: nameFromText(item) });
  });
  return { layout: 'names', rows: out, newEntries: [] };
}
