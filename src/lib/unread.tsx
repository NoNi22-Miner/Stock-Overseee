import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { unreadNotificationCount } from './api';

const POLL_MS = 30_000;

type Unread = { count: number; refresh: () => void };
const UnreadContext = createContext<Unread>({ count: 0, refresh: () => {} });

/** Unread notification count for the Inbox badge, refreshed every 30 s while the app is open. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    unreadNotificationCount().then(setCount, () => {});
  }, []);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refresh();
        if (!timer) timer = setInterval(refresh, POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    // A push arriving while the app is open updates the badge at once.
    const pushSub = Notifications.addNotificationReceivedListener(() => refresh());
    return () => {
      sub.remove();
      pushSub.remove();
      if (timer) clearInterval(timer);
    };
  }, [refresh]);

  return <UnreadContext.Provider value={{ count, refresh }}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);
