// The team's branding on this phone. The last team's look is kept on the phone, so the app (and
// the login screen) starts in the company colors even offline. When the look changes, the screens
// are drawn again with the new colors and layout.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getTeamBrand } from './api';
import { useAuth } from './auth';
import { applyTheme, type TeamTheme } from './theme';

export type Brand = { teamId: string | null; companyName: string | null; theme: TeamTheme };

type BrandState = Brand & {
  /** Use a new look now (the Team Leader after saving). `returnTo` reopens that screen afterwards. */
  applyBrand: (b: Brand, returnTo?: string) => void;
};

const KEY = 'brand:last';
const EMPTY: Brand = { teamId: null, companyName: null, theme: {} };
const BrandContext = createContext<BrandState>({ ...EMPTY, applyBrand: () => {} });

let pendingRoute: string | null = null;
/** A screen to open again after the app was redrawn with a new look (used once). */
export function takePendingRoute() {
  const r = pendingRoute;
  pendingRoute = null;
  return r;
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [ready, setReady] = useState(false);
  const [brand, setBrand] = useState<Brand>(EMPTY);
  const [version, setVersion] = useState(0);
  const themeJson = useRef('{}');

  const use = useCallback((b: Brand, returnTo?: string) => {
    const json = JSON.stringify(b.theme ?? {});
    if (json !== themeJson.current) {
      themeJson.current = json;
      applyTheme(b.theme ?? {});
      if (returnTo) pendingRoute = returnTo;
      setVersion((v) => v + 1);
    }
    setBrand(b);
    AsyncStorage.setItem(KEY, JSON.stringify(b)).catch(() => {});
  }, []);

  // The last look used on this phone, before anything is shown.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const b = JSON.parse(raw) as Brand;
        themeJson.current = JSON.stringify(b.theme ?? {});
        applyTheme(b.theme ?? {});
        setBrand(b);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // The team's current look from the server, once per sign-in.
  const teamId = profile?.team_id ?? null;
  useEffect(() => {
    if (!teamId || !ready) return;
    let alive = true;
    getTeamBrand()
      .then((t) => {
        if (alive && t) use({ teamId: t.id, companyName: t.name, theme: t.theme ?? {} });
      })
      .catch(() => {}); // offline: keep the look saved on this phone
    return () => {
      alive = false;
    };
  }, [teamId, ready, use]);

  if (!ready) return null;
  return (
    <BrandContext.Provider value={{ ...brand, applyBrand: use }}>
      <Fragment key={version}>{children}</Fragment>
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
