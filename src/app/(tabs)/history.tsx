import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { HistoryItem } from '../../components/HistoryList';
import { Chip, Empty, styles, Text } from '../../components/ui';
import { listHistory, listLocations } from '../../lib/api';
import { useLocationAccess } from '../../lib/auth';
import { colors, kindColor } from '../../lib/theme';
import type { Location, MovementKind, MovementRow } from '../../lib/types';

const KINDS: MovementKind[] = ['IN', 'OUT', 'TRANSFER', 'ADJUST'];

export default function HistoryScreen() {
  const canUse = useLocationAccess();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [kind, setKind] = useState<MovementKind | null>(null);
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [locs, hist] = await Promise.all([listLocations(true), listHistory({ locationId, kind })]);
      setLocations(locs.filter((l) => canUse(l.id)));
      setRows(hist);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [locationId, kind]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        <View style={styles.chipRow}>
          <Chip label="All" active={!locationId} onPress={() => setLocationId(null)} />
          {locations.map((l) => (
            <Chip key={l.id} label={l.code} active={locationId === l.id} onPress={() => setLocationId(l.id)} />
          ))}
        </View>
        <View style={styles.chipRow}>
          {KINDS.map((k) => (
            <Chip
              key={k}
              label={k}
              color={kindColor[k]}
              active={kind === k}
              onPress={() => setKind(kind === k ? null : k)}
            />
          ))}
        </View>
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="No movements yet." />}
        renderItem={({ item }) => <HistoryItem item={item} />}
      />
    </View>
  );
}
