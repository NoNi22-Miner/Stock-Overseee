export type LocationKind = 'warehouse' | 'store' | 'other';

export type Location = {
  id: string;
  code: string;
  name: string;
  kind: LocationKind;
  is_active: boolean;
};

export type Product = {
  id: string;
  barcode: string;
  name: string;
  unit: string;
  min_stock: number;
  is_active: boolean;
};

export type StockRow = {
  product_id: string;
  barcode: string;
  product_name: string;
  unit: string;
  min_stock: number;
  location_id: string;
  location_code: string;
  location_name: string;
  qty: number;
  is_low: boolean;
};

export type MovementKind = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUST';

export type MovementRow = {
  id: number;
  kind: MovementKind;
  qty: number;
  note: string | null;
  created_at: string;
  product_id: string;
  product_name: string;
  barcode: string;
  unit: string;
  from_location_id: string | null;
  from_code: string | null;
  to_location_id: string | null;
  to_code: string | null;
  qty_before: number | null;
  qty_after: number | null;
  actor_name: string | null;
};

export type TeamMember = {
  id: string;
  user_code: string | null;
  display_name: string;
  role: import('./roles').Role;
  is_active: boolean;
  can_transfer: boolean;
  last_seen_at: string | null;
  online: boolean;
  created_at: string;
};
