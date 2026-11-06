import { supabase } from './supabase';
import type { Location, LocationKind, MovementKind, MovementRow, Product, StockRow } from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// Locations -------------------------------------------------------------------

export async function listLocations(includeInactive = false): Promise<Location[]> {
  let q = supabase.from('locations').select('id, code, name, kind, is_active').order('created_at');
  if (!includeInactive) q = q.eq('is_active', true);
  return check(await q);
}

export async function addLocation(input: { code: string; name: string; kind: LocationKind }) {
  return check(
    await supabase
      .from('locations')
      .insert({ code: input.code.trim().toUpperCase(), name: input.name.trim(), kind: input.kind })
      .select()
      .single(),
  );
}

export async function setLocationActive(id: string, is_active: boolean) {
  check(await supabase.from('locations').update({ is_active }).eq('id', id));
}

// Products --------------------------------------------------------------------

const PRODUCT_COLS = 'id, barcode, name, unit, min_stock, is_active';

export async function listProducts(search = ''): Promise<Product[]> {
  let q = supabase.from('products').select(PRODUCT_COLS).order('name').limit(500);
  const s = search.trim();
  if (s) q = q.or(`name.ilike.%${escapeLike(s)}%,barcode.ilike.%${escapeLike(s)}%`);
  return check(await q);
}

export async function getProduct(id: string): Promise<Product> {
  return check(await supabase.from('products').select(PRODUCT_COLS).eq('id', id).single());
}

export async function findProductByBarcode(barcode: string): Promise<Product | null> {
  return check(
    await supabase.from('products').select(PRODUCT_COLS).eq('barcode', barcode.trim()).maybeSingle(),
  );
}

export type ProductInput = Omit<Product, 'id'>;

export async function saveProduct(id: string | null, input: ProductInput): Promise<Product> {
  const row = {
    barcode: input.barcode.trim(),
    name: input.name.trim(),
    unit: input.unit.trim() || 'pcs',
    min_stock: input.min_stock,
    is_active: input.is_active,
  };
  const res = id
    ? await supabase.from('products').update(row).eq('id', id).select(PRODUCT_COLS).single()
    : await supabase.from('products').insert(row).select(PRODUCT_COLS).single();
  if (res.error?.code === '23505') throw new Error('Another product already uses this barcode.');
  return check(res);
}

// Stock -----------------------------------------------------------------------

const STOCK_COLS =
  'product_id, barcode, product_name, unit, min_stock, location_id, location_code, location_name, qty, is_low';

export async function stockAtLocation(locationId: string, search = ''): Promise<StockRow[]> {
  let q = supabase
    .from('stock_overview')
    .select(STOCK_COLS)
    .eq('location_id', locationId)
    .order('product_name')
    .limit(1000);
  const s = search.trim();
  if (s) q = q.or(`product_name.ilike.%${escapeLike(s)}%,barcode.ilike.%${escapeLike(s)}%`);
  return check(await q).map(normalizeStock);
}

export async function stockForProduct(productId: string): Promise<StockRow[]> {
  return check(
    await supabase.from('stock_overview').select(STOCK_COLS).eq('product_id', productId),
  ).map(normalizeStock);
}

export async function lowStockCounts(): Promise<Record<string, number>> {
  const rows = check(await supabase.from('stock_overview').select('location_id').eq('is_low', true));
  const out: Record<string, number> = {};
  for (const r of rows as { location_id: string }[]) out[r.location_id] = (out[r.location_id] ?? 0) + 1;
  return out;
}

// Movements -------------------------------------------------------------------

export async function recordMovement(input: {
  kind: MovementKind;
  productId: string;
  qty: number;
  fromId?: string | null;
  toId?: string | null;
  note?: string;
}) {
  const { error } = await supabase.rpc('record_movement', {
    p_kind: input.kind,
    p_product_id: input.productId,
    p_qty: input.qty,
    p_from: input.fromId ?? null,
    p_to: input.toId ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function listHistory(opts: {
  locationId?: string | null;
  kind?: MovementKind | null;
  productId?: string | null;
  limit?: number;
}): Promise<MovementRow[]> {
  let q = supabase
    .from('movement_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.locationId) q = q.or(`from_location_id.eq.${opts.locationId},to_location_id.eq.${opts.locationId}`);
  if (opts.kind) q = q.eq('kind', opts.kind);
  if (opts.productId) q = q.eq('product_id', opts.productId);
  return check(await q).map((m: MovementRow) => ({ ...m, qty: Number(m.qty) }));
}

// Helpers ---------------------------------------------------------------------

function normalizeStock(r: StockRow): StockRow {
  return { ...r, qty: Number(r.qty), min_stock: Number(r.min_stock) };
}

// Keep user text from breaking PostgREST's or() filter syntax.
function escapeLike(s: string) {
  return s.replace(/[%_,()*\\]/g, ' ');
}

export function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
