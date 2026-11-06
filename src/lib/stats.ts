import { listCategories, listProducts } from './api';
import { supabase } from './supabase';
import type { Category, Product } from './types';

/** What "moving" is measured in: quantity moved, or number of movements. */
export type Metric = 'qty' | 'times';

export type DayStat = { qty: number; times: number; in: number; out: number; transfer: number };

export type ItemStats = {
  product: Product;
  total: DayStat;
  days: DayStat[]; // one entry per day of the month
};

export type MonthStats = {
  year: number;
  month: number; // 0-11
  daysInMonth: number;
  items: ItemStats[]; // every active product, plus inactive ones that moved
  allDays: DayStat[]; // all items together (times are meaningful; qty mixes units)
  totalMoves: number;
  itemsMoved: number;
  lowStock: number;
  categories: Category[];
  lowByProduct: Record<string, number>; // product id -> locations at or below minimum (now)
};

/** Category filter: a category id, 'none' for uncategorized, or null for all. */
export type CategoryFilter = string | 'none' | null;

const empty = (): DayStat => ({ qty: 0, times: 0, in: 0, out: 0, transfer: 0 });

function add(a: DayStat, b: DayStat) {
  a.qty += b.qty;
  a.times += b.times;
  a.in += b.in;
  a.out += b.out;
  a.transfer += b.transfer;
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type DailyRow = {
  product_id: string;
  day: string; // YYYY-MM-DD in the device time zone
  in_qty: number | string;
  out_qty: number | string;
  transfer_qty: number | string;
  moves: number | string;
};

/** Movement for one calendar month (the dashboard "resets" every month). */
export async function loadMonthStats(year: number, month: number): Promise<MonthStats> {
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const [daily, products, lowRes, categories] = await Promise.all([
    supabase.rpc('movement_daily', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_tz: deviceTimeZone(),
    }),
    listProducts(),
    supabase.from('stock_overview').select('product_id').eq('is_low', true),
    listCategories(),
  ]);
  if (daily.error) throw new Error(daily.error.message);
  if (lowRes.error) throw new Error(lowRes.error.message);
  const lowByProduct: Record<string, number> = {};
  for (const r of (lowRes.data ?? []) as { product_id: string }[]) {
    lowByProduct[r.product_id] = (lowByProduct[r.product_id] ?? 0) + 1;
  }

  const byId = new Map<string, ItemStats>();
  for (const p of products) {
    byId.set(p.id, {
      product: { ...p, min_stock: Number(p.min_stock) },
      total: empty(),
      days: Array.from({ length: daysInMonth }, empty),
    });
  }

  const allDays = Array.from({ length: daysInMonth }, empty);
  for (const r of (daily.data ?? []) as DailyRow[]) {
    const item = byId.get(r.product_id);
    const dayIndex = Number(r.day.slice(8, 10)) - 1;
    if (!item || dayIndex < 0 || dayIndex >= daysInMonth) continue;
    const s: DayStat = {
      in: Number(r.in_qty),
      out: Number(r.out_qty),
      transfer: Number(r.transfer_qty),
      qty: Number(r.in_qty) + Number(r.out_qty) + Number(r.transfer_qty),
      times: Number(r.moves),
    };
    add(item.days[dayIndex], s);
    add(item.total, s);
    add(allDays[dayIndex], s);
  }

  // Inactive products only matter if they moved this month.
  const items = [...byId.values()].filter((i) => i.product.is_active || i.total.times > 0);
  const totalMoves = items.reduce((n, i) => n + i.total.times, 0);
  const itemsMoved = items.filter((i) => i.total.times > 0).length;
  const lowStock = Object.values(lowByProduct).reduce((n, c) => n + c, 0);

  return { year, month, daysInMonth, items, allDays, totalMoves, itemsMoved, lowStock, categories, lowByProduct };
}

const inCategory = (p: Product, filter: CategoryFilter) =>
  filter === null || (filter === 'none' ? !p.category_id : p.category_id === filter);

/** The month's stats limited to one category (or all), with totals recomputed. */
export function scopeToCategory(stats: MonthStats, filter: CategoryFilter): MonthStats {
  if (filter === null) return stats;
  const items = stats.items.filter((i) => inCategory(i.product, filter));
  const allDays = Array.from({ length: stats.daysInMonth }, empty);
  for (const i of items) i.days.forEach((d, n) => add(allDays[n], d));
  return {
    ...stats,
    items,
    allDays,
    totalMoves: items.reduce((n, i) => n + i.total.times, 0),
    itemsMoved: items.filter((i) => i.total.times > 0).length,
    lowStock: items.reduce((n, i) => n + (stats.lowByProduct[i.product.id] ?? 0), 0),
  };
}

export type CategoryTotal = { id: string | 'none'; name: string; total: DayStat; products: number };

/** Movement per category this month, busiest first; includes categories that did not move. */
export function byCategory(stats: MonthStats, metric: Metric): CategoryTotal[] {
  const rows = new Map<string, CategoryTotal>();
  for (const c of stats.categories) rows.set(c.id, { id: c.id, name: c.name, total: empty(), products: 0 });
  for (const i of stats.items) {
    const key = i.product.category_id && rows.has(i.product.category_id) ? i.product.category_id : 'none';
    if (!rows.has(key)) rows.set(key, { id: 'none', name: 'Uncategorized', total: empty(), products: 0 });
    const row = rows.get(key)!;
    add(row.total, i.total);
    row.products += 1;
  }
  return [...rows.values()]
    .filter((r) => r.id !== 'none' || r.products > 0)
    .sort((a, b) => value(b.total, metric) - value(a.total, metric) || a.name.localeCompare(b.name));
}

const value = (s: DayStat, metric: Metric) => (metric === 'qty' ? s.qty : s.times);

export function mostMoving(stats: MonthStats, metric: Metric, n = 5) {
  return stats.items
    .filter((i) => value(i.total, metric) > 0)
    .sort((a, b) => value(b.total, metric) - value(a.total, metric) || a.product.name.localeCompare(b.product.name))
    .slice(0, n);
}

/** Least moving active products, including those that did not move at all. */
export function leastMoving(stats: MonthStats, metric: Metric, n = 5) {
  return stats.items
    .filter((i) => i.product.is_active)
    .sort((a, b) => value(a.total, metric) - value(b.total, metric) || a.product.name.localeCompare(b.product.name))
    .slice(0, n);
}

export function movedItems(stats: MonthStats, metric: Metric) {
  return mostMoving(stats, metric, Number.POSITIVE_INFINITY);
}

export { value as metricValue };
