import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, View } from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { HistoryItem } from '../../components/HistoryList';
import { Button, Card, Chip, Field, styles } from '../../components/ui';
import { formatQty, getProduct, listCategories, listHistory, saveProduct, stockForProduct } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { can } from '../../lib/roles';
import { colors } from '../../lib/theme';
import type { Category, MovementRow, StockRow } from '../../lib/types';

export default function ProductScreen() {
  const params = useLocalSearchParams<{ id: string; barcode?: string }>();
  const isNew = params.id === 'new';
  const editable = can.manageProducts(useRole());

  const [loading, setLoading] = useState(!isNew);
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [minStock, setMinStock] = useState('0');
  const [active, setActive] = useState(true);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [history, setHistory] = useState<MovementRow[]>([]);
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reload when coming back from "Manage categories".
  useFocusEffect(
    useCallback(() => {
      listCategories()
        .then(setCategories)
        .catch(() => {});
    }, []),
  );

  useEffect(() => {
    if (isNew) return;
    Promise.all([getProduct(params.id), stockForProduct(params.id), listHistory({ productId: params.id, limit: 30 })])
      .then(([p, s, h]) => {
        setBarcode(p.barcode);
        setName(p.name);
        setUnit(p.unit);
        setMinStock(formatQty(Number(p.min_stock)));
        setActive(p.is_active);
        setCategoryId(p.category_id);
        setStock(s);
        setHistory(h);
      })
      .catch((e) => Alert.alert('Error', e.message))
      .finally(() => setLoading(false));
  }, [isNew, params.id]);

  const minNum = Number(minStock.replace(',', '.'));
  const valid = barcode.trim() && name.trim() && minNum >= 0;

  async function save() {
    setSaving(true);
    try {
      await saveProduct(isNew ? null : params.id, {
        barcode,
        name,
        unit,
        min_stock: minNum,
        is_active: active,
        category_id: categoryId,
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isNew ? 'New product' : name || 'Product' }} />

      {!isNew && (
        <Card>
          <Text style={styles.label}>Stock</Text>
          <View style={[styles.chipRow, { gap: 16 }]}>
            {stock.map((s) => (
              <Text key={s.location_id} style={{ fontSize: 16, color: s.is_low ? colors.warn : colors.text }}>
                {s.location_code}: <Text style={{ fontWeight: '800' }}>{formatQty(s.qty)}</Text> {s.unit}
                {s.is_low ? ' (low)' : ''}
              </Text>
            ))}
          </View>
        </Card>
      )}

      <View style={[styles.row, { alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Field
            label="Barcode"
            value={barcode}
            onChangeText={setBarcode}
            autoCapitalize="none"
            autoCorrect={false}
            editable={editable}
          />
        </View>
        {editable && <Button title="Scan" variant="outline" onPress={() => setCamera(true)} />}
      </View>
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Indomie Goreng 85g"
        editable={editable}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="Unit"
            value={unit}
            onChangeText={setUnit}
            placeholder="pcs, box, kg"
            autoCapitalize="none"
            editable={editable}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Min stock (alert at or below)"
            value={minStock}
            onChangeText={setMinStock}
            keyboardType="decimal-pad"
            editable={editable}
          />
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          <Chip label="Uncategorized" active={categoryId === null} onPress={() => editable && setCategoryId(null)} />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={categoryId === c.id}
              onPress={() => editable && setCategoryId(c.id)}
            />
          ))}
          {editable && (
            <Chip label="+ Manage" active={false} color={colors.muted} onPress={() => router.push('/categories')} />
          )}
        </View>
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={{ color: colors.text, fontSize: 16 }}>Active</Text>
        <Switch value={active} onValueChange={setActive} disabled={!editable} />
      </View>
      {editable && (
        <Button title={isNew ? 'Create product' : 'Save changes'} onPress={save} loading={saving} disabled={!valid} />
      )}

      {!isNew && (
        <>
          <Text style={[styles.title, { marginTop: 12 }]}>Recent movements</Text>
          {history.length === 0 ? (
            <Text style={styles.muted}>None yet.</Text>
          ) : (
            history.map((m) => <HistoryItem key={m.id} item={m} showProduct={false} />)
          )}
        </>
      )}

      <BarcodeScanner
        visible={camera}
        onClose={() => setCamera(false)}
        onScanned={(c) => {
          setCamera(false);
          setBarcode(c);
        }}
      />
    </ScrollView>
  );
}
