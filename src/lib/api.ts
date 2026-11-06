import { supabase } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Role } from './roles';
import type {
  Category,
  Location,
  LocationKind,
  MovementKind,
  MovementRow,
  Product,
  StockRow,
  Team,
  TeamMember,
} from './types';

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

const PRODUCT_COLS = 'id, barcode, name, unit, min_stock, is_active, category_id';

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
  return check(await supabase.from('products').select(PRODUCT_COLS).eq('barcode', barcode.trim()).maybeSingle());
}

export type ProductInput = Omit<Product, 'id'>;

export async function saveProduct(id: string | null, input: ProductInput): Promise<Product> {
  const row = {
    barcode: input.barcode.trim(),
    name: input.name.trim(),
    unit: input.unit.trim() || 'pcs',
    min_stock: input.min_stock,
    is_active: input.is_active,
    category_id: input.category_id,
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
  return check(await supabase.from('stock_overview').select(STOCK_COLS).eq('product_id', productId)).map(
    normalizeStock,
  );
}

export async function lowStockCounts(): Promise<Record<string, number>> {
  const rows = check(await supabase.from('stock_overview').select('location_id').eq('is_low', true));
  const out: Record<string, number> = {};
  for (const r of rows as { location_id: string }[]) out[r.location_id] = (out[r.location_id] ?? 0) + 1;
  return out;
}

// Movements -------------------------------------------------------------------

export async function recordMovement(input: {
  kind: Exclude<MovementKind, 'ADJUST'>;
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

export async function recordAdjustment(input: {
  productId: string;
  locationId: string;
  newQty: number;
  note?: string;
}) {
  const { error } = await supabase.rpc('record_adjustment', {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_new_qty: input.newQty,
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
  return check(await q).map((m: MovementRow) => ({
    ...m,
    qty: Number(m.qty),
    qty_before: m.qty_before == null ? null : Number(m.qty_before),
    qty_after: m.qty_after == null ? null : Number(m.qty_after),
  }));
}

// Team & accounts -------------------------------------------------------------

const ROLE_ORDER: Record<Role, number> = { owner: 0, oversee: 1, staff: 2, onlooker: 3 };

export async function listTeam(): Promise<TeamMember[]> {
  const rows: TeamMember[] = check(await supabase.from('team_presence').select('*'));
  return rows.sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (a.display_name || a.user_code || '').localeCompare(b.display_name || b.user_code || ''),
  );
}

export async function getTeamMember(id: string): Promise<TeamMember> {
  return check(await supabase.from('team_presence').select('*').eq('id', id).single());
}

type ManageUserBody =
  | {
      action: 'create';
      user_code: string;
      username: string;
      display_name: string;
      role: Role;
      password: string;
      can_transfer: boolean;
    }
  | {
      action: 'update';
      user_id: string;
      user_code?: string;
      username?: string;
      display_name?: string;
      role?: Role;
      is_active?: boolean;
      can_transfer?: boolean;
    }
  | { action: 'set_password'; user_id: string; password: string }
  | { action: 'delete'; user_id: string }
  | { action: 'delete_team'; confirm_name: string };

/** Team Leader-only account changes, done by the "manage-users" Edge Function. */
export async function manageUser(body: ManageUserBody): Promise<{ ok: true; id?: string }> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  return data;
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

// Login & teams ---------------------------------------------------------------

/** Turns what was typed in the login box (UserID, Username or email) into the Auth email. */
export async function resolveLogin(identifier: string): Promise<string> {
  const { data, error } = await supabase.rpc('resolve_login', { p_identifier: identifier });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function createTeam(teamName: string, displayName: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_team', { p_team_name: teamName, p_display_name: displayName });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getMyTeam(): Promise<Team | null> {
  return check(await supabase.from('teams').select('id, name').maybeSingle());
}

export async function renameTeam(id: string, name: string) {
  check(await supabase.from('teams').update({ name: name.trim() }).eq('id', id));
}

// Categories ------------------------------------------------------------------

export async function listCategories(): Promise<Category[]> {
  return check(await supabase.from('categories').select('id, name').order('name'));
}

function categoryError(e: { message: string; code?: string } | null) {
  if (!e) return;
  if (e.code === '23505') throw new Error('A category with that name already exists.');
  throw new Error(e.message);
}

export async function addCategory(name: string) {
  const { error } = await supabase.from('categories').insert({ name: name.trim() });
  categoryError(error);
}

export async function renameCategory(id: string, name: string) {
  const { error } = await supabase.from('categories').update({ name: name.trim() }).eq('id', id);
  categoryError(error);
}

/** Products in the category become uncategorized. */
export async function deleteCategory(id: string) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  categoryError(error);
}
