import { listProducts, lowStockCounts } from './api';
import { supabase } from './supabase';
import type { Product } from './types';

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
};

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

  const [daily, products, low] = await Promise.all([
    supabase.rpc('movement_daily', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_tz: deviceTimeZone(),
    }),
    listProducts(),
    lowStockCounts(),
  ]);
  if (daily.error) throw new Error(daily.error.message);

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
  const lowStock = Object.values(low).reduce((n, c) => n + c, 0);

  return { year, month, daysInMonth, items, allDays, totalMoves, itemsMoved, lowStock };
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
