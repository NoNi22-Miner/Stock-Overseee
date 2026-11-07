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
  // Every word typed must be in the name or code, in any order ("plat 10mm kp").
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = products.filter(
    (p) =>
      (category === null || (category === 'none' ? !p.category_id : p.category_id === category)) &&
      words.every((w) => p.name.toLowerCase().includes(w) || p.barcode.toLowerCase().includes(w)),
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        {manage && (
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Button
              title="+ Add item"
              style={{ flexGrow: 1 }}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
            />
            <Button title="Import Excel" variant="outline" onPress={() => router.push('/import')} />
          </View>
        )}
        <Button title="Recognition Table" variant="outline" onPress={() => router.push('/recognition')} />
        <TextInput
          style={styles.input}
          placeholder="Search name or code"
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
        ListEmptyComponent={loading ? undefined : <Empty text="No items found." />}
        ListHeaderComponent={
          <Text style={styles.muted}>
            {shown.length} item{shown.length === 1 ? '' : 's'}
          </Text>
        }
        initialNumToRender={25}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/product/${item.id}`)}
            style={[styles.card, !item.is_active && { opacity: 0.5 }]}
          >
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.muted}>
              {item.structured ? '' : `${categoryName(item.category_id)} · `}
              {item.barcode} · {item.unit} · min {formatQty(Number(item.min_stock))}
              {item.is_active ? '' : ' · inactive'}
            </Text>
            {!item.structured && (
              <Text style={{ color: colors.warn, fontSize: 12, fontWeight: '700' }}>NOT STRUCTURED</Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
