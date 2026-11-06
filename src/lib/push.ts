// Phone push notifications (Android, via Firebase Cloud Messaging).
// The server pushes every Inbox notification to the phones registered here.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

let registeredToken: string | null = null;

// Show notifications that arrive while the app is open, too.
if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

/**
 * Asks for permission (Android 13+), creates the channel and registers this phone for the
 * signed-in member. Returns false when push isn't available (e.g. Firebase not set up yet);
 * the in-app Inbox works either way.
 */
export async function registerForPush(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Stock updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#1565C0',
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return false;

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== 'string' || !token) return false;
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: 'android' });
    if (error) return false;
    registeredToken = token;
    return true;
  } catch {
    // Firebase not configured in this build, or no Google Play services.
    return false;
  }
}

/** Keep the server's copy of the token current if Firebase rotates it. */
export function watchPushToken() {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addPushTokenListener(({ data }) => {
    if (typeof data === 'string' && data && data !== registeredToken) {
      registeredToken = data;
      supabase.rpc('register_push_token', { p_token: data, p_platform: 'android' }).then(
        () => {},
        () => {},
      );
    }
  });
  return () => sub.remove();
}

/** Stop pushing to this phone (on sign out). */
export async function unregisterPush() {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // best effort
  }
}

/** Where tapping a notification should take the user. */
export function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  if (typeof data.transfer_id === 'string' && data.transfer_id) return `/transfer/${data.transfer_id}`;
  if (typeof data.product_id === 'string' && data.product_id) return `/product/${data.product_id}`;
  return '/inbox';
}
