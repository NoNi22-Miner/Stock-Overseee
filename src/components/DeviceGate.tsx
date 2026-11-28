import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, styles, Text } from './ui';
import { colors } from '../lib/theme';

/** Shown when this phone is not the Team Leader's bound device. Password sign-in is the way back. */
export function ReplaceDeviceGate({
  onReplace,
  onSignOut,
}: {
  onReplace: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={[styles.screen, styles.pad, { justifyContent: 'center' }]}>
      <Card style={{ gap: 10 }}>
        <Text style={styles.title}>This account is on another device</Text>
        <Text style={{ color: colors.text }}>
          The Team Leader account stays on one device. Replace it with this phone to continue. The other phone is
          signed out of stock changes.
        </Text>
        <Text style={styles.muted}>
          If you lost the other phone, replacing it here is the way back in. You only need the password you just used.
          You cannot be locked out for good.
        </Text>
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
        <Button
          title="Replace the bound device"
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await onReplace();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          loading={busy}
        />
        <Button title="Sign out" variant="outline" color={colors.muted} onPress={() => onSignOut()} />
      </Card>
    </View>
  );
}

export function RevokedDeviceGate({ onSignOut }: { onSignOut: () => Promise<void> }) {
  return (
    <View style={[styles.screen, styles.pad, { justifyContent: 'center' }]}>
      <Card style={{ gap: 10 }}>
        <Text style={styles.title}>This device was signed out</Text>
        <Text style={{ color: colors.text }}>
          The Team Leader signed this device out. Sign in again if you are still allowed to use this account.
        </Text>
        <Button title="Sign out" onPress={() => onSignOut()} />
      </Card>
    </View>
  );
}
