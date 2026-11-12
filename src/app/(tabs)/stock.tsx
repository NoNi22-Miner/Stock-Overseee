import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { LocationPicker } from '../../components/LocationPicker';
import { Chip, Empty, styles, Text } from '../../components/ui';
import { formatQty, listLocations, lowStockCounts, stockAtLocation } from '../../lib/api';
import { useLocationAccess } from '../../lib/auth';
import { colors, fs } from '../../lib/theme';
import type { Location, StockRow } from '../../lib/types';

export default function StockScreen() {
  const canUse = useLocationAccess();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [lowCounts, setLowCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const locs = (await listLocations()).filter((l) => canUse(l.id));
      setLocations(locs);
      const current = locs.find((l) => l.id === locationId)?.id ?? locs[0]?.id ?? null;
      setLocationId(current);
      const [stock, low] = await Promise.all([
        current ? stockAtLocation(current) : Promise.resolve([]),
        lowStockCounts(),
      ]);
      setRows(stock);
      setLowCounts(low);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const q = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!lowOnly || r.is_low) && (!q || r.product_name.toLowerCase().includes(q) || r.barcode.toLowerCase().includes(q)),
  );
  const lowHere = locationId ? (lowCounts[locationId] ?? 0) : 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        <LocationPicker locations={locations} value={locationId} onChange={setLocationId} badges={lowCounts} />
        <TextInput
          style={styles.input}
          placeholder="Search name or barcode"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        <View style={styles.row}>
          <Chip
            label={`Low stock${lowHere ? ` (${lowHere})` : ''}`}
            active={lowOnly}
            onPress={() => setLowOnly((v) => !v)}
            color={colors.warn}
          />
          <Text style={styles.muted}>{shown.length} items</Text>
        </View>
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.product_id}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          loading ? undefined : (
            <Empty text={lowOnly ? 'No low-stock items here.' : 'No products yet. Add one in Products.'} />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/product/${item.product_id}`)}
            style={[
              styles.card,
              { flexDirection: 'row', alignItems: 'center' },
              item.is_low && { borderColor: colors.warn, backgroundColor: colors.warnBg },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.title}>{item.product_name}</Text>
              <Text style={styles.muted}>
                {item.barcode}
                {item.min_stock > 0 ? `  ·  min ${formatQty(item.min_stock)}` : ''}
              </Text>
              {item.is_low && <Text style={{ color: colors.warn, fontWeight: '700' }}>Low stock</Text>}
            </View>
            <Text style={{ fontSize: fs(22), fontWeight: '800', color: item.is_low ? colors.warn : colors.text }}>
              {formatQty(item.qty)}
              <Text style={styles.muted}> {item.unit}</Text>
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
