import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

function RootStack() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const signedIn = !!session;
  const hasAccess = signedIn && !!profile?.role && profile.is_active;

  return (
    <Stack screenOptions={{ headerTintColor: colors.primary }}>
      <Stack.Protected guard={hasAccess}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="product/[id]" options={{ title: 'Product' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Account' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasAccess}>
        <Stack.Screen name="no-access" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootStack />
    </AuthProvider>
  );
}
