// Working without internet:
// - online/offline status
// - a per-account copy of data on the phone (products, locations, stock, profile)
// - a queue of In / Out / Transfer scans made offline, sent in order when back online.
//   Each scan has its own id, so a retry is never counted twice (record_movement_sync).
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Online status -------------------------------------------------------------------

let online = true;
const onlineListeners = new Set<(o: boolean) => void>();

NetInfo.addEventListener((state) => {
  const now = !!state.isConnected && state.isInternetReachable !== false;
  if (now === online) return;
  online = now;
  onlineListeners.forEach((l) => l(now));
  if (now) syncQueue();
});

export const isOnline = () => online;

export function useOnline() {
  const [value, setValue] = useState(online);
  useEffect(() => {
    onlineListeners.add(setValue);
    setValue(online);
    return () => {
      onlineListeners.delete(setValue);
    };
  }, []);
  return value;
}

export function isNetworkError(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  return /network request failed|failed to fetch|fetch failed|network error|timed? ?out|aborted|offline/i.test(msg);
}

// Local copy of data --------------------------------------------------------------------

let scope = 'signed-out';
/** Keep each account's copy separate on a shared phone. */
export function setOfflineScope(userId: string | null) {
  scope = userId ?? 'signed-out';
  queueCache = null;
  notifyQueue();
}

type Cached<T> = { at: string; value: T };

export async function cacheGet<T>(key: string): Promise<Cached<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(`cache:${scope}:${key}`);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T) {
  try {
    await AsyncStorage.setItem(`cache:${scope}:${key}`, JSON.stringify({ at: new Date().toISOString(), value }));
  } catch {
    // storage full or unavailable: the app still works online
  }
}

/** Load from the server (and keep a copy); when offline, use the last copy on this phone. */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ value: T; fromCache: boolean; at: string }> {
  if (online) {
    try {
      const value = await fetcher();
      cacheSet(key, value);
      return { value, fromCache: false, at: new Date().toISOString() };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  const copy = await cacheGet<T>(key);
  if (copy) return { value: copy.value, fromCache: true, at: copy.at };
  throw new Error('You are offline, and this has not been loaded on this phone yet.');
}

// Scan queue --------------------------------------------------------------------------------

export type QueuedScan = {
  client_id: string;
  kind: 'IN' | 'OUT' | 'TRANSFER';
  product_id: string;
  product_name: string;
  unit: string;
  qty: number;
  from_id: string | null;
  to_id: string | null;
  from_code: string | null;
  to_code: string | null;
  note: string;
  scanned_at: string;
  status: 'pending' | 'failed';
  error?: string;
};

let queueCache: QueuedScan[] | null = null;
const queueListeners = new Set<(q: QueuedScan[]) => void>();
const queueKey = () => `queue:${scope}`;

async function loadQueue(): Promise<QueuedScan[]> {
  if (queueCache) return queueCache;
  try {
    const raw = await AsyncStorage.getItem(queueKey());
    queueCache = raw ? (JSON.parse(raw) as QueuedScan[]) : [];
  } catch {
    queueCache = [];
  }
  return queueCache;
}

async function saveQueue(q: QueuedScan[]) {
  queueCache = q;
  notifyQueue();
  try {
    await AsyncStorage.setItem(queueKey(), JSON.stringify(q));
  } catch {
    // keep it in memory at least
  }
}

function notifyQueue() {
  loadQueue().then((q) => queueListeners.forEach((l) => l(q)));
}

export function useQueue() {
  const [q, setQ] = useState<QueuedScan[]>(queueCache ?? []);
  useEffect(() => {
    queueListeners.add(setQ);
    loadQueue().then(setQ);
    return () => {
      queueListeners.delete(setQ);
    };
  }, []);
  return q;
}

/** Random v4 UUID (good enough as a one-time id for a scan). */
export function newClientId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function send(s: QueuedScan) {
  const { error } = await supabase.rpc('record_movement_sync', {
    p_client_id: s.client_id,
    p_scanned_at: s.scanned_at,
    p_kind: s.kind,
    p_product_id: s.product_id,
    p_qty: s.qty,
    p_from: s.from_id,
    p_to: s.to_id,
    p_note: s.note || null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Record an In / Out / Transfer. Online it is sent at once; offline (or if the connection drops)
 * it is queued. Returns whether it was queued.
 */
export async function submitScan(scan: Omit<QueuedScan, 'client_id' | 'scanned_at' | 'status'>) {
  const item: QueuedScan = {
    ...scan,
    client_id: newClientId(),
    scanned_at: new Date().toISOString(),
    status: 'pending',
  };
  if (online) {
    try {
      await send(item);
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e; // a real problem (e.g. not enough stock): tell the user now
    }
  }
  await saveQueue([...(await loadQueue()), item]);
  return { queued: true };
}

let syncing: Promise<{ synced: number; failed: number }> | null = null;

/** Send queued scans in order. Stops at the first network error; server refusals are marked failed. */
export function syncQueue() {
  if (syncing) return syncing;
  syncing = (async () => {
    let synced = 0;
    let failed = 0;
    for (const item of [...(await loadQueue())]) {
      if (item.status !== 'pending') continue;
      if (!online) break;
      try {
        await send(item);
        synced++;
        await saveQueue((await loadQueue()).filter((x) => x.client_id !== item.client_id));
      } catch (e) {
        if (isNetworkError(e)) break;
        failed++;
        await saveQueue(
          (await loadQueue()).map((x) =>
            x.client_id === item.client_id ? { ...x, status: 'failed', error: (e as Error).message } : x,
          ),
        );
      }
    }
    await syncSpellings().catch(() => {});
    return { synced, failed };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Try a failed scan again, optionally with a corrected quantity. */
export async function retryScan(clientId: string, qty?: number) {
  await saveQueue(
    (await loadQueue()).map((x) =>
      x.client_id === clientId ? { ...x, status: 'pending', error: undefined, qty: qty ?? x.qty } : x,
    ),
  );
  return syncQueue();
}

export async function discardScan(clientId: string) {
  await saveQueue((await loadQueue()).filter((x) => x.client_id !== clientId));
}

// Learned spellings made offline ------------------------------------------------------------------

type PendingSpelling = { spelling: string; product_id: string };
const spellingsKey = () => `spellings:${scope}`;

export async function pendingSpellings(): Promise<PendingSpelling[]> {
  try {
    const raw = await AsyncStorage.getItem(spellingsKey());
    return raw ? (JSON.parse(raw) as PendingSpelling[]) : [];
  } catch {
    return [];
  }
}

async function savePendingSpellings(list: PendingSpelling[]) {
  try {
    await AsyncStorage.setItem(spellingsKey(), JSON.stringify(list.slice(-500)));
  } catch {
    // not important enough to fail a scan
  }
}

async function sendSpelling(s: PendingSpelling) {
  const { error } = await supabase
    .from('product_aliases')
    .upsert({ spelling: s.spelling, product_id: s.product_id }, { onConflict: 'team_id,spelling' });
  if (error) throw new Error(error.message);
}

/** Remember that this text means this item. Kept on the phone and sent when online. */
export async function learnSpelling(spelling: string, productId: string) {
  const item = { spelling, product_id: productId };
  const rest = (await pendingSpellings()).filter((x) => x.spelling !== spelling);
  if (online) {
    try {
      await sendSpelling(item);
      await savePendingSpellings(rest);
      return;
    } catch (e) {
      if (!isNetworkError(e)) {
        await savePendingSpellings(rest);
        return; // e.g. an Onlooker: nothing to keep
      }
    }
  }
  await savePendingSpellings([...rest, item]);
}

async function syncSpellings() {
  const list = await pendingSpellings();
  if (!list.length) return;
  const left: PendingSpelling[] = [];
  for (const s of list) {
    if (!online) {
      left.push(s);
      continue;
    }
    try {
      await sendSpelling(s);
    } catch (e) {
      if (isNetworkError(e)) left.push(s);
    }
  }
  await savePendingSpellings(left);
}

/** Keep trying while scans are waiting: every 30 s and whenever the connection comes back. */
export function useAutoSync() {
  const q = useQueue();
  const pending = q.some((x) => x.status === 'pending');
  useEffect(() => {
    if (!pending) return;
    syncQueue();
    const t = setInterval(() => syncQueue(), 30_000);
    return () => clearInterval(t);
  }, [pending]);
}
