import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Button, Empty, styles } from '../../components/ui';
import { formatQty, listProducts } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { can } from '../../lib/roles';
import { colors } from '../../lib/theme';
import type { Product } from '../../lib/types';

export default function ProductsScreen() {
  const role = useRole();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await listProducts());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const q = search.trim().toLowerCase();
  const shown = products.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        {can.manageProducts(role) && (
          <Button
            title="+ Add product"
            onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Search name or barcode"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          loading ? undefined : <Empty text="No products found." />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/product/${item.id}`)}
            style={[styles.card, !item.is_active && { opacity: 0.5 }]}
          >
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.muted}>
              {item.barcode} · {item.unit} · min {formatQty(Number(item.min_stock))}
              {item.is_active ? '' : ' · inactive'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
