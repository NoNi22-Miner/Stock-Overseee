import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, View } from 'react-native';
import { AuthProvider, useAuth } from '../lib/auth';
import { BrandProvider, takePendingRoute } from '../lib/brand';
import { routeForNotification } from '../lib/push';
import { colors } from '../lib/theme';

/** Opens the transfer / product a tapped phone notification is about. */
function NotificationTaps({ ready }: { ready: boolean }) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!ready || !last) return;
    const route = routeForNotification(last.notification.request.content.data as Record<string, unknown>);
    if (route) router.push(route as never);
    Notifications.clearLastNotificationResponse();
  }, [ready, last]);
  return null;
}

function RootStack() {
  const { session, profile, loading } = useAuth();

  // After the look changed, open again the screen that changed it (the app was redrawn).
  useEffect(() => {
    if (loading) return;
    const r = takePendingRoute();
    if (r) setTimeout(() => router.push(r as never), 50);
  }, [loading]);
  // Phone notifications exist on Android / iOS only.
  const taps = Platform.OS !== 'web' && (
    <NotificationTaps ready={!loading && !!session && !!profile?.role && !!profile?.is_active} />
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        {taps}
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const signedIn = !!session;
  const hasAccess = signedIn && !!profile?.role && profile.is_active && !!profile.team_id;
  // A new email sign-up that has not created its team yet.
  const needsTeam = signedIn && !!profile && !profile.role && !profile.team_id;

  return (
    <>
      {taps}
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={hasAccess}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="product/[id]" options={{ title: 'Item' }} />
          <Stack.Screen name="user/[id]" options={{ title: 'Account' }} />
          <Stack.Screen name="recognition" options={{ title: 'Recognition Table' }} />
          <Stack.Screen name="import" options={{ title: 'Import items' }} />
          <Stack.Screen name="transfer/[id]" options={{ title: 'Transfer' }} />
          <Stack.Screen name="queue" options={{ title: 'Waiting to sync' }} />
          <Stack.Screen name="branding" options={{ title: 'Theme & layout' }} />
        </Stack.Protected>
        <Stack.Protected guard={needsTeam}>
          <Stack.Screen name="create-team" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !hasAccess && !needsTeam}>
          <Stack.Screen name="no-access" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/** Navigation colors (headers, screen backgrounds) from the team's theme. */
function navTheme() {
  const base = colors.mode === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: colors.mode === 'dark',
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      notification: colors.out,
    },
  };
}

/** Drawn again (inside BrandProvider) whenever the team's look changes. */
function ThemedApp() {
  return (
    <ThemeProvider value={navTheme()}>
      <StatusBar style={colors.mode === 'dark' ? 'light' : 'dark'} />
      <RootStack />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <BrandProvider>
        <ThemedApp />
      </BrandProvider>
    </AuthProvider>
  );
}
