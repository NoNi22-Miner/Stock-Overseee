// This phone's stable id, and the sign-in record sent to the team.
// Place is a city and country looked up from the network address. The app does not ask for GPS.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { newClientId } from './offline';
import { supabase } from './supabase';

const KEY = 'device:key';
let deviceKey = '';

export function currentDeviceKey() {
  return deviceKey;
}

export async function loadDeviceKey() {
  if (deviceKey) return deviceKey;
  try {
    const saved = await AsyncStorage.getItem(KEY);
    deviceKey = saved && saved.length >= 8 ? saved : newClientId();
    if (deviceKey !== saved) await AsyncStorage.setItem(KEY, deviceKey);
  } catch {
    deviceKey = deviceKey || newClientId();
  }
  return deviceKey;
}

function appVersion() {
  return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '';
}

function modelName() {
  const named = (Constants as { deviceName?: string }).deviceName;
  if (named) return named;
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android';
  return 'Web';
}

/** City, region, country from the public IP. Null when the lookup cannot be done. */
export async function coarsePlace(): Promise<string | null> {
  const lookup = (async () => {
    const res = await fetch('https://ipwho.is/');
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; city?: string; region?: string; country?: string };
    if (!body.success) return null;
    const place = [body.city, body.region, body.country].filter(Boolean).join(', ');
    return place.slice(0, 120) || null;
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  try {
    return await Promise.race([lookup, timeout]);
  } catch {
    return null;
  }
}

export type DeviceGate = { ok: true } | { ok: false; code: 'replace_required' | 'revoked' } | { ok: true; offline: true };

export async function registerDevice(replace = false): Promise<DeviceGate> {
  const key = await loadDeviceKey();
  const place = await coarsePlace().catch(() => null);
  const { data, error } = await supabase.rpc('register_device', {
    p_device_key: key,
    p_model: modelName(),
    p_os_name: Platform.OS,
    p_os_version: String(Platform.Version ?? ''),
    p_app_version: appVersion(),
    p_place: place,
    p_replace: replace,
  });
  if (error) {
    if (/network|fetch|offline/i.test(error.message)) return { ok: true, offline: true };
    throw new Error(error.message);
  }
  const row = (data ?? {}) as { ok?: boolean; code?: string };
  if (row.ok) return { ok: true };
  if (row.code === 'replace_required' || row.code === 'revoked') return { ok: false, code: row.code };
  return { ok: true };
}

export async function releaseOwnerDevice() {
  const key = await loadDeviceKey();
  const { error } = await supabase.rpc('release_owner_device', { p_device_key: key });
  if (error) throw new Error(error.message);
}

export async function revokeDevice(id: string) {
  const { error } = await supabase.rpc('revoke_device', { p_id: id });
  if (error) throw new Error(error.message);
}

export type MemberDevice = {
  id: string;
  user_id: string;
  device_key: string;
  model: string | null;
  os_name: string | null;
  os_version: string | null;
  app_version: string | null;
  ip: string | null;
  place: string | null;
  signed_in_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  profiles: { display_name: string | null; role: string | null; user_code: string | null } | null;
};

export async function listDevices(): Promise<MemberDevice[]> {
  const { data, error } = await supabase
    .from('member_devices')
    .select(
      'id, user_id, device_key, model, os_name, os_version, app_version, ip, place, signed_in_at, last_seen_at, revoked_at, profiles(display_name, role, user_code)',
    )
    .order('last_seen_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MemberDevice[];
}
