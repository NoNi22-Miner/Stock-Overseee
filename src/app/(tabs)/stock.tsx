import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { LocationPicker } from '../../components/LocationPicker';
import { Chip, Empty, styles, Text } from '../../components/ui';
import { formatQty, listLocations, listProducts, lowStockCounts, stockAtLocation } from '../../lib/api';
import { useLocationAccess } from '../../lib/auth';
import { familyKey, familyName, gradeOrder, gradeShort } from '../../lib/grades';
import { cached } from '../../lib/offline';
import { useRecognition } from '../../lib/recognition';
import { colors, fs } from '../../lib/theme';
import type { Location, Product, StockRow } from '../../lib/types';

/** One item with all its grade versions at this location. */
type Group = {
  key: string;
  name: string;
  unit: string;
  qty: number;
  low: boolean;
  versions: { row: StockRow; grade: string | null; note: string | null }[];
};

export default function StockScreen() {
  const canUse = useLocationAccess();
  const { dict } = useRecognition();
  const [products, setProducts] = useState<Product[]>([]);
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
      const [stock, low, prods] = await Promise.all([
        current ? stockAtLocation(current) : Promise.resolve([]),
        lowStockCounts(),
        cached('products', listProducts).catch(() => null),
      ]);
      setRows(stock);
      setLowCounts(low);
      if (prods) setProducts(prods.value);
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

  // Grade versions of an item are shown together: "A 20 · B 3 · C 1 = 24".
  const groups = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const map = new Map<string, Group>();
    for (const row of rows) {
      const p = byId.get(row.product_id);
      const key = p ? familyKey(p) : `id:${row.product_id}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          name: p ? familyName(p, dict) : row.product_name,
          unit: row.unit,
          qty: 0,
          low: false,
          versions: [],
        };
        map.set(key, g);
      }
      g.versions.push({ row, grade: p?.grade_id ?? null, note: p?.grade_note?.trim() || null });
      g.qty += row.qty;
      g.low ||= row.is_low;
    }
    const list = [...map.values()];
    for (const g of list) {
      g.versions.sort((a, b) => gradeOrder(a.grade, dict) - gradeOrder(b.grade, dict));
      if (g.versions.length === 1) g.name = g.versions[0].row.product_name;
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [rows, products, dict]);

  // Every word typed must be in the name or code, in any order.
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = groups.filter(
    (g) =>
      (!lowOnly || g.low) &&
      words.every(
        (w) =>
          g.name.toLowerCase().includes(w) ||
          g.versions.some(
            (v) => v.row.product_name.toLowerCase().includes(w) || v.row.barcode.toLowerCase().includes(w),
          ),
      ),
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
          <Text style={styles.muted}>
            {shown.length} item{shown.length === 1 ? '' : 's'}
          </Text>
        </View>
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(g) => g.key}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          loading ? undefined : (
            <Empty text={lowOnly ? 'No low-stock items here.' : 'No products yet. Add one in Products.'} />
          )
        }
        renderItem={({ item }) =>
          item.versions.length === 1 ? (
            <OneItem row={item.versions[0].row} note={item.versions[0].note} />
          ) : (
            <Pressable
              onPress={() => {
                // Open the version with the most stock here.
                const top = [...item.versions].sort((a, b) => b.row.qty - a.row.qty)[0];
                router.push(`/product/${top.row.product_id}`);
              }}
              style={[
                styles.card,
                { flexDirection: 'row', alignItems: 'center' },
                item.low && { borderColor: colors.warn, backgroundColor: colors.warnBg },
              ]}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.title}>{item.name}</Text>
                <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
                  {item.versions.map(({ row, grade }) => (
                    <View
                      key={row.product_id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'baseline',
                        gap: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: row.is_low ? colors.warn : colors.border,
                      }}
                    >
                      <Text style={{ color: colors.muted, fontWeight: '700', fontSize: fs(12) }}>
                        {gradeShort(grade, dict)}
                      </Text>
                      <Text style={{ color: row.is_low ? colors.warn : colors.text, fontWeight: '800' }}>
                        {formatQty(row.qty)}
                      </Text>
                    </View>
                  ))}
                </View>
                {item.versions
                  .filter((v) => v.note)
                  .map((v) => (
                    <Text key={v.row.product_id} style={styles.muted}>
                      {gradeShort(v.grade, dict)}: {v.note}
                    </Text>
                  ))}
                {item.low && <Text style={{ color: colors.warn, fontWeight: '700' }}>Low stock</Text>}
              </View>
              <Text style={{ fontSize: fs(22), fontWeight: '800', color: item.low ? colors.warn : colors.text }}>
                {formatQty(item.qty)}
                <Text style={styles.muted}> {item.unit}</Text>
              </Text>
            </Pressable>
          )
        }
      />
    </View>
  );
}

/** An item with one version: as before (name, code, min stock). */
function OneItem({ row, note }: { row: StockRow; note: string | null }) {
  return (
    <Pressable
      onPress={() => router.push(`/product/${row.product_id}`)}
      style={[
        styles.card,
        { flexDirection: 'row', alignItems: 'center' },
        row.is_low && { borderColor: colors.warn, backgroundColor: colors.warnBg },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{row.product_name}</Text>
        <Text style={styles.muted}>
          {row.barcode}
          {row.min_stock > 0 ? `  ·  min ${formatQty(row.min_stock)}` : ''}
        </Text>
        {note && <Text style={styles.muted}>Remark: {note}</Text>}
        {row.is_low && <Text style={{ color: colors.warn, fontWeight: '700' }}>Low stock</Text>}
      </View>
      <Text style={{ fontSize: fs(22), fontWeight: '800', color: row.is_low ? colors.warn : colors.text }}>
        {formatQty(row.qty)}
        <Text style={styles.muted}> {row.unit}</Text>
      </Text>
    </Pressable>
  );
}
