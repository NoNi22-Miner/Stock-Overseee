import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Role } from './roles';
import { supabase } from './supabase';

export type Profile = {
  id: string;
  user_code: string | null;
  display_name: string;
  role: Role | null;
  is_active: boolean;
  can_transfer: boolean;
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  profileError: null,
  reloadProfile: async () => {},
  signOut: async () => {},
});

const HEARTBEAT_MS = 60_000;

function ping(online: boolean) {
  supabase.rpc('touch_presence', { p_online: online }).then(
    () => {},
    () => {},
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Which user the current profile was loaded for (null = not loaded yet).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const reloadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setProfileError(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, user_code, display_name, role, is_active, can_transfer')
      .eq('id', userId)
      .maybeSingle();
    if (error) setProfileError(error.message);
    setProfile((data as Profile | null) ?? null);
    setLoadedFor(userId);
  }, [userId]);

  useEffect(() => {
    reloadProfile();
  }, [reloadProfile]);

  // "Online" heartbeat while the app is open and in the foreground.
  const active = !!profile?.role && profile.is_active;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      ping(true);
      if (!timer) timer = setInterval(() => ping(true), HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      ping(false);
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      if (timer) clearInterval(timer);
    };
  }, [active, userId]);

  const signOut = useCallback(async () => {
    try {
      await supabase.rpc('touch_presence', { p_online: false });
    } catch {
      // ignore: going offline is best effort
    }
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const loading = sessionLoading || (!!userId && loadedFor !== userId);

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileError, reloadProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function useRole(): Role | null {
  const { profile } = useAuth();
  return profile?.is_active ? profile.role : null;
}
