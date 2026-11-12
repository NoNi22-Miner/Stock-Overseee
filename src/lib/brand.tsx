// The team's branding on this phone. The last team's look is kept on the phone, so the app (and
// the login screen) starts in the company colors even offline. When the look changes, the screens
// are drawn again with the new colors and layout.
// Also each person's own text and icon size: kept on the phone per account, not shared with the team.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getTeamBrand } from './api';
import { useAuth } from './auth';
import { applyDisplay, applyTheme, DEFAULT_DISPLAY, type DisplayPrefs, type TeamTheme } from './theme';

export type Brand = { teamId: string | null; companyName: string | null; theme: TeamTheme };

type BrandState = Brand & {
  /** Use a new look now (the Team Leader after saving). `returnTo` reopens that screen afterwards. */
  applyBrand: (b: Brand, returnTo?: string) => void;
  /** This person's text and icon size on this phone. */
  display: DisplayPrefs;
  setDisplay: (prefs: DisplayPrefs, returnTo?: string) => void;
};

const KEY = 'brand:last';
const DISPLAY_KEY = 'display:prefs';
/** Sizes per account on this phone, plus the last ones used (for the login screen). */
type StoredDisplay = { last?: DisplayPrefs; users?: Record<string, DisplayPrefs> };
const EMPTY: Brand = { teamId: null, companyName: null, theme: {} };
const BrandContext = createContext<BrandState>({
  ...EMPTY,
  applyBrand: () => {},
  display: DEFAULT_DISPLAY,
  setDisplay: () => {},
});

let pendingRoute: string | null = null;
/** A screen to open again after the app was redrawn with a new look (used once). */
export function takePendingRoute() {
  const r = pendingRoute;
  pendingRoute = null;
  return r;
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { profile, session } = useAuth();
  const [ready, setReady] = useState(false);
  const [brand, setBrand] = useState<Brand>(EMPTY);
  const [display, setDisplayState] = useState<DisplayPrefs>(DEFAULT_DISPLAY);
  const [version, setVersion] = useState(0);
  const themeJson = useRef('{}');
  const displayJson = useRef(JSON.stringify(DEFAULT_DISPLAY));
  const storedDisplay = useRef<StoredDisplay>({});
  const userId = session?.user.id ?? null;

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

  /** Switch to these sizes (drawing the app again if they differ from the ones in use). */
  const showDisplay = useCallback((prefs: DisplayPrefs, returnTo?: string) => {
    const next: DisplayPrefs = { text: prefs.text ?? 'normal', icons: prefs.icons ?? 'normal' };
    const json = JSON.stringify(next);
    if (json === displayJson.current) return;
    displayJson.current = json;
    applyDisplay(next);
    if (returnTo) pendingRoute = returnTo;
    setDisplayState(next);
    setVersion((v) => v + 1);
  }, []);

  const setDisplay = useCallback(
    (prefs: DisplayPrefs, returnTo?: string) => {
      storedDisplay.current = {
        last: prefs,
        users: { ...storedDisplay.current.users, ...(userId ? { [userId]: prefs } : {}) },
      };
      AsyncStorage.setItem(DISPLAY_KEY, JSON.stringify(storedDisplay.current)).catch(() => {});
      showDisplay(prefs, returnTo);
    },
    [userId, showDisplay],
  );

  // The last look and sizes used on this phone, before anything is shown.
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(DISPLAY_KEY)])
      .then(([raw, rawDisplay]) => {
        if (rawDisplay) {
          storedDisplay.current = JSON.parse(rawDisplay) as StoredDisplay;
          const last = { ...DEFAULT_DISPLAY, ...storedDisplay.current.last };
          displayJson.current = JSON.stringify(last);
          applyDisplay(last);
          setDisplayState(last);
        }
        if (raw) {
          const b = JSON.parse(raw) as Brand;
          themeJson.current = JSON.stringify(b.theme ?? {});
          applyTheme(b.theme ?? {});
          setBrand(b);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Each account has its own sizes on a shared phone (a new account starts at Normal).
  useEffect(() => {
    if (!ready || !userId) return;
    const mine = { ...DEFAULT_DISPLAY, ...storedDisplay.current.users?.[userId] };
    if (JSON.stringify(storedDisplay.current.last) !== JSON.stringify(mine)) {
      storedDisplay.current = { ...storedDisplay.current, last: mine };
      AsyncStorage.setItem(DISPLAY_KEY, JSON.stringify(storedDisplay.current)).catch(() => {});
    }
    showDisplay(mine);
  }, [ready, userId, showDisplay]);

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
    <BrandContext.Provider value={{ ...brand, applyBrand: use, display, setDisplay }}>
      <Fragment key={version}>{children}</Fragment>
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
