import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { Button, Card, Chip, Field, styles } from '../../components/ui';
import { addLocation, listLocations, setLocationActive } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import type { Location, LocationKind } from '../../lib/types';

const KINDS: { kind: LocationKind; label: string }[] = [
  { kind: 'warehouse', label: 'Warehouse' },
  { kind: 'store', label: 'Store' },
  { kind: 'other', label: 'Other' },
];

export default function MoreScreen() {
  const { session } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('store');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listLocations(true)
      .then(setLocations)
      .catch((e) => Alert.alert('Error', e.message));
  }, []);

  useFocusEffect(load);

  async function add() {
    setBusy(true);
    try {
      await addLocation({ code, name, kind });
      setCode('');
      setName('');
      load();
    } catch (e) {
      const msg = (e as Error).message;
      Alert.alert('Could not add location', msg.includes('duplicate') ? 'That code is already used.' : msg);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(l: Location) {
    try {
      await setLocationActive(l.id, !l.is_active);
      load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }

  const validCode = /^[A-Z0-9_-]{1,12}$/.test(code.trim().toUpperCase());

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Locations</Text>
      {locations.map((l) => (
        <Card key={l.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {l.code} <Text style={styles.muted}>· {l.kind}</Text>
            </Text>
            <Text style={styles.muted}>{l.name}</Text>
          </View>
          <Switch value={l.is_active} onValueChange={() => toggle(l)} />
        </Card>
      ))}

      <Card style={{ gap: 10 }}>
        <Text style={styles.title}>Add location</Text>
        <Field
          label="Code (short, e.g. TOKO2)"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          maxLength={12}
        />
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Toko Cabang 2" />
        <View style={styles.chipRow}>
          {KINDS.map((k) => (
            <Chip key={k.kind} label={k.label} active={kind === k.kind} onPress={() => setKind(k.kind)} />
          ))}
        </View>
        <Button title="Add location" onPress={add} loading={busy} disabled={!validCode || !name.trim()} />
      </Card>

      <Text style={[styles.title, { marginTop: 12 }]}>Account</Text>
      <Card>
        <Text style={{ color: colors.text }}>{session?.user.email}</Text>
        <Button title="Sign out" variant="outline" color={colors.out} onPress={() => supabase.auth.signOut()} />
      </Card>
    </ScrollView>
  );
}
