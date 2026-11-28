import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Button, Card, styles, Text } from '../components/ui';
import { useAuth, useRole } from '../lib/auth';
import { currentDeviceKey, listDevices, releaseOwnerDevice, revokeDevice, type MemberDevice } from '../lib/device';
import { can, ROLE_LABEL, type Role } from '../lib/roles';
import { colors } from '../lib/theme';

function when(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function person(d: MemberDevice) {
  const p = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
  const role = p?.role && p.role in ROLE_LABEL ? ROLE_LABEL[p.role as Role] : p?.role;
  return {
    name: p?.display_name || p?.user_code || 'Member',
    role: role ?? '',
  };
}

/** Team Leader only. Everyone else's devices are hidden by the database as well as by this screen. */
export default function DevicesScreen() {
  const role = useRole();
  const { signOut } = useAuth();
  const allowed = can.manageUsers(role);
  const [rows, setRows] = useState<MemberDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = currentDeviceKey();

  const load = useCallback(() => {
    if (!allowed) return;
    listDevices()
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!allowed) {
    return (
      <View style={[styles.screen, styles.pad]}>
        <Text style={styles.title}>Only the Team Leader can open Device Controller.</Text>
      </View>
    );
  }

  const active = rows.filter((d) => !d.revoked_at);
  const revoked = rows.filter((d) => d.revoked_at);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}>
      <Text style={styles.muted}>
        The Team Leader account is bound to one device. A new phone is asked to replace that device before it can
        change stock. Replacing it signs the other phone out. If the bound phone is lost, sign in on the new phone
        with the same password and choose Replace. That is the way back in.
      </Text>
      <Text style={styles.muted}>
        Place is the city and country of the network address at sign-in. The app does not ask for GPS and does not
        store a precise location.
      </Text>
      {error && <Text style={{ color: colors.out }}>{error}</Text>}
      <Text style={styles.title}>Signed in</Text>
      {active.length === 0 && <Text style={styles.muted}>No devices yet. They appear after the next sign-in.</Text>}
      {active.map((d) => {
        const who = person(d);
        const here = d.device_key === mine;
        return (
          <Card key={d.id} style={{ gap: 4 }}>
            <Text style={styles.title}>
              {who.name}
              {who.role ? ` · ${who.role}` : ''}
              {here ? ' · this device' : ''}
            </Text>
            <Text style={{ color: colors.text }}>
              {[d.model, [d.os_name, d.os_version].filter(Boolean).join(' ')].filter(Boolean).join(' · ') ||
                'Unknown device'}
              {d.app_version ? ` · app ${d.app_version}` : ''}
            </Text>
            <Text style={styles.muted}>Signed in {when(d.signed_in_at)}</Text>
            <Text style={styles.muted}>Last active {when(d.last_seen_at)}</Text>
            <Text style={styles.muted}>{d.place ? `Near ${d.place}` : 'Place unknown'}</Text>
            {!!d.ip && <Text style={styles.muted}>Network {d.ip}</Text>}
            {!here && (
              <Button
                title="Sign out this device"
                variant="outline"
                color={colors.out}
                loading={busy === d.id}
                onPress={() => {
                  Alert.alert('Sign out this device?', `${who.name} will need to sign in again to change stock.`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Sign out',
                      style: 'destructive',
                      onPress: async () => {
                        setBusy(d.id);
                        try {
                          await revokeDevice(d.id);
                          load();
                        } catch (e) {
                          Alert.alert('Could not sign out', (e as Error).message);
                        } finally {
                          setBusy(null);
                        }
                      },
                    },
                  ]);
                }}
              />
            )}
          </Card>
        );
      })}
      {hereIsBound(active, mine) && (
        <Button
          title="Let the next phone become the bound device"
          variant="outline"
          onPress={() => {
            Alert.alert(
              'Release this device?',
              'After you sign out, the next Team Leader sign-in becomes the bound device. Do that on the new phone soon.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Release and sign out',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await releaseOwnerDevice();
                      await signOut();
                    } catch (e) {
                      Alert.alert('Could not release', (e as Error).message);
                    }
                  },
                },
              ],
            );
          }}
        />
      )}
      {revoked.length > 0 && <Text style={[styles.title, { marginTop: 8 }]}>Signed out</Text>}
      {revoked.map((d) => {
        const who = person(d);
        return (
          <Card key={d.id} style={{ gap: 2, opacity: 0.75 }}>
            <Text style={styles.title}>{who.name}</Text>
            <Text style={styles.muted}>
              {[d.model, d.os_name].filter(Boolean).join(' · ') || 'Unknown device'} · signed out {when(d.revoked_at)}
            </Text>
          </Card>
        );
      })}
    </ScrollView>
  );
}

function hereIsBound(rows: MemberDevice[], mine: string) {
  return rows.some((d) => d.device_key === mine && !d.revoked_at);
}
