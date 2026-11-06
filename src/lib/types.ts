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
  category_id: string | null;
};

export type Category = { id: string; name: string };

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
  created_by: string | null;
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
  transfer_id: string | null;
  detail: 'receive' | 'return' | 'late' | null;
  scanned_at: string | null;
};

export type TransferStatus = 'in_transit' | 'short' | 'done';

export type Transfer = {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  barcode: string;
  from_location_id: string;
  to_location_id: string;
  from_code: string;
  to_code: string;
  qty_sent: number;
  qty_received: number | null;
  qty_returned: number;
  qty_late: number;
  qty_lost: number;
  qty_open: number;
  status: TransferStatus;
  note: string | null;
  receive_note: string | null;
  sent_by: string | null;
  sent_by_name: string | null;
  sent_at: string;
  received_by_name: string | null;
  received_at: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
};

export type NotificationKind =
  | 'transfer_incoming'
  | 'transfer_received'
  | 'transfer_short'
  | 'transfer_resolved'
  | 'stock_change'
  | 'low_stock';

export type AppNotification = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  data: { transfer_id?: string; product_id?: string; location_id?: string; movement_id?: number };
  created_at: string;
  read_at: string | null;
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
  username: string | null;
  all_locations: boolean;
  location_ids: string[];
};

export type Team = { id: string; name: string };
