import { supabase } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Role } from './roles';
import type {
  Category,
  Term,
  Location,
  LocationKind,
  MovementKind,
  MovementRow,
  Product,
  StockRow,
  AppNotification,
  Team,
  TeamMember,
  Transfer,
} from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// Locations -------------------------------------------------------------------

export async function listLocations(includeInactive = false): Promise<Location[]> {
  let q = supabase.from('locations').select('id, code, name, kind, is_active, aliases').order('created_at');
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

/** Other spellings of a location on paperwork, e.g. "PNK IPS" for WRH. */
export async function setLocationAliases(id: string, aliases: string[]) {
  check(await supabase.from('locations').update({ aliases }).eq('id', id));
}

// Products --------------------------------------------------------------------

const PRODUCT_COLS =
  'id, barcode, name, unit, min_stock, is_active, category_id, structured, grade_id, brand_id, label_ids, mark_ids, size';

/** Reads every row of a query, 1000 at a time (the server's page limit). */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await page(from, from + 999)) ?? [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function listProducts(search = ''): Promise<Product[]> {
  const s = search.trim();
  return allRows<Product>((from, to) => {
    let q = supabase.from('products').select(PRODUCT_COLS).order('name').range(from, to);
    if (s) q = q.or(`name.ilike.%${escapeLike(s)}%,barcode.ilike.%${escapeLike(s)}%`);
    return q;
  });
}

export async function getProduct(id: string): Promise<Product> {
  return check(await supabase.from('products').select(PRODUCT_COLS).eq('id', id).single());
}

export async function findProductByBarcode(barcode: string): Promise<Product | null> {
  return check(await supabase.from('products').select(PRODUCT_COLS).eq('barcode', barcode.trim()).maybeSingle());
}

export type ProductInput = Omit<Product, 'id'>;

/** For a structured item the database builds the name from the parts; an empty code gets one (IT…). */
export async function saveProduct(id: string | null, input: ProductInput): Promise<Product> {
  const row = {
    barcode: input.barcode.trim() || null,
    name: input.name.trim() || 'item',
    unit: input.unit,
    min_stock: input.min_stock,
    is_active: input.is_active,
    category_id: input.category_id,
    structured: input.structured,
    grade_id: input.structured ? input.grade_id : null,
    brand_id: input.structured ? input.brand_id : null,
    label_ids: input.structured ? input.label_ids : [],
    mark_ids: input.structured ? input.mark_ids : [],
    size: input.structured ? input.size.map((s) => s.trim()).filter(Boolean) : [],
  };
  const res = id
    ? await supabase.from('products').update(row).eq('id', id).select(PRODUCT_COLS).single()
    : await supabase.from('products').insert(row).select(PRODUCT_COLS).single();
  if (res.error?.code === '23505') {
    throw new Error(
      res.error.message.startsWith('This item already exists')
        ? res.error.message
        : 'Another item already uses this code / barcode.',
    );
  }
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
      all_locations: boolean;
      location_ids: string[];
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
      all_locations?: boolean;
      location_ids?: string[];
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

// Recognition Table: categories, grades, labels, brands, marks ---------------------------------

const CATEGORY_COLS = 'id, name, aliases, size_pattern, default_unit';

export async function listCategories(): Promise<Category[]> {
  return check(await supabase.from('categories').select(CATEGORY_COLS).order('name'));
}

function listError(e: { message: string; code?: string } | null, what: string) {
  if (!e) return;
  if (e.code === '23505') throw new Error(`A ${what} with that name already exists.`);
  throw new Error(e.message);
}

export type CategoryInput = Omit<Category, 'id'>;

export async function saveCategory(id: string | null, input: CategoryInput) {
  const row = {
    name: input.name.trim(),
    aliases: input.aliases,
    size_pattern: input.size_pattern,
    default_unit: input.default_unit,
  };
  const { error } = id
    ? await supabase.from('categories').update(row).eq('id', id)
    : await supabase.from('categories').insert(row);
  listError(error, 'category');
}

/** Refused while items still use it. Items not split into parts become uncategorized. */
export async function deleteCategory(id: string) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  listError(error, 'category');
}

export async function listTerms(): Promise<Term[]> {
  return check(await supabase.from('recognition_terms').select('id, kind, name, aliases, meaning').order('name'));
}

export async function saveTerm(id: string | null, input: Omit<Term, 'id'>) {
  const row = { kind: input.kind, name: input.name.trim(), aliases: input.aliases, meaning: input.meaning };
  const { error } = id
    ? await supabase.from('recognition_terms').update(row).eq('id', id)
    : await supabase.from('recognition_terms').insert(row);
  listError(error, input.kind);
}

/** Refused while items still use it. */
export async function deleteTerm(id: string) {
  const { error } = await supabase.from('recognition_terms').delete().eq('id', id);
  listError(error, 'entry');
}

/** Learned spellings: text read from paper -> the item someone picked for it. */
export async function listSpellings(): Promise<{ spelling: string; product_id: string }[]> {
  return allRows((from, to) =>
    supabase.from('product_aliases').select('spelling, product_id').order('spelling').range(from, to),
  );
}

export async function saveSpelling(spelling: string, productId: string) {
  const { error } = await supabase
    .from('product_aliases')
    .upsert({ spelling, product_id: productId }, { onConflict: 'team_id,spelling' });
  if (error) throw new Error(error.message);
}

export type ImportItem = {
  category: string;
  grade?: string | null;
  labels: string[];
  size: string[];
  brand?: string | null;
  marks: string[];
  unit: string;
  min_stock?: number;
  barcode?: string | null;
};

/** Adds the items (and any missing categories / list entries); items that already exist are skipped. */
export async function importItems(items: ImportItem[]) {
  const { data, error } = await supabase.rpc('import_items', { p_items: items });
  if (error) throw new Error(error.message);
  return data as { added: number; skipped: number; new_list_entries: number };
}

// Location access ----------------------------------------------------------------

/** Locations the signed-in member may use (all of them for the Team Leader). */
export async function myLocationIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('my_location_ids');
  if (error) throw new Error(error.message);
  return ((data ?? []) as (string | { my_location_ids: string })[]).map((r) =>
    typeof r === 'string' ? r : r.my_location_ids,
  );
}

// Transfers ------------------------------------------------------------------------

const num = (v: unknown) => (v == null ? null : Number(v));

function normalizeTransfer(t: Transfer): Transfer {
  return {
    ...t,
    qty_sent: Number(t.qty_sent),
    qty_received: num(t.qty_received),
    qty_returned: Number(t.qty_returned),
    qty_late: Number(t.qty_late),
    qty_lost: Number(t.qty_lost),
    qty_open: Number(t.qty_open),
  };
}

export async function listTransfers(opts: { status?: Transfer['status'][]; limit?: number } = {}) {
  let q = supabase
    .from('transfer_list')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status?.length) q = q.in('status', opts.status);
  return (check(await q) as Transfer[]).map(normalizeTransfer);
}

export async function getTransfer(id: string): Promise<Transfer> {
  return normalizeTransfer(check(await supabase.from('transfer_list').select('*').eq('id', id).single()));
}

export async function receiveTransfer(id: string, qty: number, note?: string) {
  const { error } = await supabase.rpc('receive_transfer', {
    p_transfer_id: id,
    p_qty_received: qty,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export type ResolveOutcome = 'returned' | 'late' | 'lost';

export async function resolveTransfer(id: string, outcome: ResolveOutcome, qty: number, note?: string) {
  const { error } = await supabase.rpc('resolve_transfer', {
    p_transfer_id: id,
    p_outcome: outcome,
    p_qty: qty,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

// Notifications -----------------------------------------------------------------

export async function listNotifications(limit = 100): Promise<AppNotification[]> {
  return check(
    await supabase
      .from('notifications')
      .select('id, kind, title, body, data, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function unreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Mark the given notifications (or all when omitted) as read. */
export async function markNotificationsRead(ids?: number[]) {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
  if (error) throw new Error(error.message);
}

export async function setNotifyChanges(on: boolean) {
  const { error } = await supabase.rpc('set_my_notify_changes', { p_on: on });
  if (error) throw new Error(error.message);
}

/** All stock rows the member may see (every product × their locations), for the offline copy. */
export async function listMyStock(): Promise<StockRow[]> {
  return check(await supabase.from('stock_overview').select(STOCK_COLS).limit(10000)).map(normalizeStock);
}
