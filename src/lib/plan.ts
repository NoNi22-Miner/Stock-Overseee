// Plans (per team): Free, Pro (Monthly / Lifetime) and Supporter. Limits are enforced by the
// database (supabase/migrations/20261107020000_plans.sql); the app shows them and the prices.
import { supabase } from './supabase';
import { colors } from './theme';

export type PlanKey = 'free' | 'pro' | 'supporter';

export type PlanInfo = {
  /** The plan in force now (an ended Monthly plan counts as free). */
  plan: PlanKey;
  /** What is saved (e.g. 'pro' with a date in the past). */
  saved_plan: PlanKey;
  plan_until: string | null;
  plan_source: 'code' | 'google_play' | 'developer' | null;
  max_locations: number;
  max_per_role: number;
  /** This member is past the plan's limit: view-only until Pro is back. */
  locked: boolean;
  locked_locations: string[];
  locked_members: string[];
  locations: number;
  members: Partial<Record<'owner' | 'oversee' | 'staff' | 'onlooker', number>>;
  developer: boolean;
};

export const FREE_INFO: PlanInfo = {
  plan: 'free',
  saved_plan: 'free',
  plan_until: null,
  plan_source: null,
  max_locations: 1,
  max_per_role: 1,
  locked: false,
  locked_locations: [],
  locked_members: [],
  locations: 0,
  members: {},
  developer: false,
};

export const PRICES = {
  monthly: { label: 'Pro Monthly', price: '$1', per: 'a month' },
  lifetime: { label: 'Pro Lifetime', price: '$10', per: 'once' },
  supporter: { label: 'Supporter', price: '$20', per: 'once' },
};

export function planLabel(info: Pick<PlanInfo, 'plan' | 'plan_until'>) {
  if (info.plan === 'supporter') return 'Supporter';
  if (info.plan === 'pro') return info.plan_until ? 'Pro Monthly' : 'Pro Lifetime';
  return 'Free';
}

export const isPro = (info: Pick<PlanInfo, 'plan'>) => info.plan === 'pro' || info.plan === 'supporter';

export async function getPlanInfo(): Promise<PlanInfo> {
  const { data, error } = await supabase.rpc('my_plan_info');
  if (error) throw new Error(error.message);
  return { ...FREE_INFO, ...((data as Partial<PlanInfo> | null) ?? {}) };
}

/** Team Leader: use an activation code. */
export async function redeemCode(code: string): Promise<PlanInfo> {
  const { data, error } = await supabase.rpc('redeem_code', { p_code: code });
  if (error) throw new Error(error.message);
  const res = data as (Partial<PlanInfo> & { error?: string }) | null;
  if (res?.error) throw new Error(res.error);
  return { ...FREE_INFO, ...(res ?? {}) };
}

/** How to buy a code (set by the developer). */
export async function getContact(): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'contact').maybeSingle();
  return (data?.value as string | undefined) ?? '';
}

// Feature requests (Supporter) ------------------------------------------------------------------

export type RequestStatus = 'new' | 'planned' | 'done' | 'declined';
export type FeatureRequest = {
  id: number;
  title: string;
  body: string;
  status: RequestStatus;
  reply: string | null;
  created_at: string;
  updated_at: string;
  team_name?: string;
  team_plan?: PlanKey;
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: 'New',
  planned: 'Planned',
  done: 'Done',
  declined: 'Not planned',
};

export const statusColor = (s: RequestStatus) =>
  s === 'done' ? colors.in : s === 'planned' ? colors.primary : s === 'declined' ? colors.muted : colors.warn;

export async function listMyRequests(): Promise<FeatureRequest[]> {
  const { data, error } = await supabase
    .from('feature_requests')
    .select('id, title, body, status, reply, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data as FeatureRequest[];
}

export async function sendRequest(title: string, body: string) {
  const { error } = await supabase.from('feature_requests').insert({ title: title.trim(), body: body.trim() });
  if (error) throw new Error(error.message);
}

// Developer tools ------------------------------------------------------------------------------------

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type DevCode = {
  hint: string;
  plan: 'pro' | 'supporter';
  months: number | null;
  note: string | null;
  created_at: string;
  redeemed_at: string | null;
  team_name: string | null;
};
export type DevTeam = {
  id: string;
  name: string;
  plan: PlanKey;
  saved_plan: PlanKey;
  plan_until: string | null;
  plan_source: string | null;
  members: number;
  locations: number;
  created_at: string;
};

export const dev = {
  makeCodes: (plan: 'pro' | 'supporter', months: number | null, count: number, note: string) =>
    rpc<string[]>('dev_make_codes', { p_plan: plan, p_months: months, p_count: count, p_note: note }),
  codes: () => rpc<DevCode[]>('dev_codes', { p_limit: 200 }),
  teams: () => rpc<DevTeam[]>('dev_teams'),
  setPlan: (team: string, plan: PlanKey, until: string | null) =>
    rpc<void>('dev_set_plan', { p_team: team, p_plan: plan, p_until: until }),
  requests: () => rpc<FeatureRequest[]>('dev_requests'),
  answer: (id: number, status: RequestStatus, reply: string) =>
    rpc<void>('dev_answer_request', { p_id: id, p_status: status, p_reply: reply }),
  setContact: (value: string) => rpc<void>('dev_set_contact', { p_value: value }),
};

export function codeLabel(c: Pick<DevCode, 'plan' | 'months'>) {
  if (c.plan === 'supporter') return 'Supporter';
  return c.months ? `Pro ${c.months} month${c.months === 1 ? '' : 's'}` : 'Pro Lifetime';
}
