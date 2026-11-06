import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Chip, Empty, styles } from '../../components/ui';
import { formatQty, listCategories, listProducts } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { can } from '../../lib/roles';
import { colors } from '../../lib/theme';
import type { Category, Product } from '../../lib/types';

/** Category filter value: a category id, 'none' for uncategorized, or null for all. */
type CategoryFilter = string | 'none' | null;

export default function ProductsScreen() {
  const role = useRole();
  const manage = can.manageProducts(role);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<CategoryFilter>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([listProducts(), listCategories()]);
      setProducts(p);
      setCategories(c);
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

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  const q = search.trim().toLowerCase();
  const shown = products.filter(
    (p) =>
      (category === null || (category === 'none' ? !p.category_id : p.category_id === category)) &&
      (!q || p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q)),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        {manage && (
          <View style={styles.row}>
            <Button
              title="+ Add product"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
            />
            <Button title="Categories" variant="outline" onPress={() => router.push('/categories')} />
          </View>
        )}
        <TextInput
          style={styles.input}
          placeholder="Search name or barcode"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
        {categories.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="All" active={category === null} onPress={() => setCategory(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} active={category === c.id} onPress={() => setCategory(c.id)} />
            ))}
            <Chip label="Uncategorized" active={category === 'none'} onPress={() => setCategory('none')} />
          </ScrollView>
        )}
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="No products found." />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/product/${item.id}`)}
            style={[styles.card, !item.is_active && { opacity: 0.5 }]}
          >
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.muted}>
              {categoryName(item.category_id)} · {item.barcode} · {item.unit} · min {formatQty(Number(item.min_stock))}
              {item.is_active ? '' : ' · inactive'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
