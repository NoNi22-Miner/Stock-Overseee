import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { HistoryItem } from '../../components/HistoryList';
import { PartChips, type ChipOption } from '../../components/PartChips';
import { Button, Card, Chip, Field, styles } from '../../components/ui';
import { formatQty, getProduct, listHistory, listProducts, saveProduct, stockForProduct } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { cached } from '../../lib/offline';
import { useRecognition } from '../../lib/recognition';
import { buildName, finishSize, fitToPattern, patternText, splitName, UNITS } from '../../lib/recognize';
import { can } from '../../lib/roles';
import { colors } from '../../lib/theme';
import type { MovementRow, Product, SizeBox, StockRow, TermKind } from '../../lib/types';

export default function ProductScreen() {
  const params = useLocalSearchParams<{ id: string; barcode?: string; text?: string }>();
  const isNew = params.id === 'new';
  const editable = can.manageProducts(useRole());
  const { data, dict, reload: reloadLists } = useRecognition();

  const [loading, setLoading] = useState(!isNew);
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [plainName, setPlainName] = useState('');
  const [structured, setStructured] = useState(true);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [gradeId, setGradeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [markIds, setMarkIds] = useState<string[]>([]);
  const [sizeBoxes, setSizeBoxes] = useState<string[]>([]);
  /** The size does not follow the category's boxes: edit it as plain boxes, so it is kept as it is. */
  const [freeSize, setFreeSize] = useState(false);
  const [unit, setUnit] = useState('Pcs');
  const [unitTouched, setUnitTouched] = useState(false);
  const [minStock, setMinStock] = useState('0');
  const [active, setActive] = useState(true);
  const [notUnderstood, setNotUnderstood] = useState<string[]>([]);
  /** Show all categories again (after one is picked only that one is shown). */
  const [pickCategory, setPickCategory] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [history, setHistory] = useState<MovementRow[]>([]);
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);

  // Lists may have changed in the Recognition Table.
  useFocusEffect(
    useCallback(() => {
      reloadLists();
      cached('products', listProducts)
        .then((r) => setProducts(r.value))
        .catch(() => {});
    }, [reloadLists]),
  );

  function placeSize(values: string[], pattern: SizeBox[]) {
    const fit = fitToPattern(values, pattern);
    setFreeSize(!!values.length && !!pattern.length && !fit);
    setSizeBoxes(fit ?? values);
  }

  /** Fill the parts from a name (an old typed name, or text read by the camera). */
  function fillFromText(text: string) {
    const r = splitName(text, dict, true);
    setCategoryId(r.categoryId);
    setGradeId(r.gradeId);
    setLabelIds(r.labelIds);
    setBrandId(r.brandId);
    setMarkIds(r.markIds);
    const cat = r.categoryId ? dict.categoryById.get(r.categoryId) : null;
    placeSize(r.size, cat?.size_pattern ?? []);
    setNotUnderstood(r.unknown);
    if (cat && !unitTouched) setUnit(cat.default_unit);
  }

  // Set while a loaded item's size waits for its category's boxes (the lists load separately).
  const [loadedSize, setLoadedSize] = useState<string[] | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (isNew) return;
    Promise.all([getProduct(params.id), stockForProduct(params.id), listHistory({ productId: params.id, limit: 30 })])
      .then(([p, s, h]) => {
        setBarcode(p.barcode);
        setPlainName(p.name);
        setStructured(p.structured);
        setCategoryId(p.category_id);
        setGradeId(p.grade_id);
        setLabelIds(p.label_ids ?? []);
        setBrandId(p.brand_id);
        setMarkIds(p.mark_ids ?? []);
        // Shown as saved until the category's boxes are known.
        setSizeBoxes(p.size ?? []);
        setFreeSize(true);
        setLoadedSize(p.size ?? []);
        setUnit(p.unit);
        setUnitTouched(true);
        setMinStock(formatQty(Number(p.min_stock)));
        setActive(p.is_active);
        setStock(s);
        setHistory(h);
      })
      .catch((e) => Alert.alert('Error', e.message))
      .finally(() => setLoading(false));
  }, [isNew, params.id]);

  // Once the lists are here: put a loaded item's size into its category's boxes, and start a new
  // item from words read by the camera. (Done while rendering, once, instead of in an effect.)
  if (loadedSize && data.categories.length && (!categoryId || dict.categoryById.get(categoryId))) {
    placeSize(loadedSize, (categoryId && dict.categoryById.get(categoryId)?.size_pattern) || []);
    setLoadedSize(null);
  }
  if (isNew && !prefilled && params.text && data.categories.length) {
    setPrefilled(true);
    fillFromText(params.text);
  }

  const category = categoryId ? dict.categoryById.get(categoryId) : undefined;
  const pattern = freeSize ? [] : (category?.size_pattern ?? []);

  // Lists, with what this category already uses first.
  const options = (kind: TermKind): ChipOption[] =>
    data.terms
      .filter((t) => t.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((t) => ({ id: t.id, name: t.name }));
  const used = useMemo(() => {
    const out: Record<TermKind, Set<string>> = {
      grade: new Set(),
      label: new Set(),
      brand: new Set(),
      mark: new Set(),
    };
    for (const p of products) {
      if (!p.structured || p.category_id !== categoryId) continue;
      if (p.grade_id) out.grade.add(p.grade_id);
      if (p.brand_id) out.brand.add(p.brand_id);
      (p.label_ids ?? []).forEach((id) => out.label.add(id));
      (p.mark_ids ?? []).forEach((id) => out.mark.add(id));
    }
    return out;
  }, [products, categoryId]);

  function chooseCategory(id: string | null) {
    if (id === categoryId) return;
    const cat = id ? dict.categoryById.get(id) : undefined;
    placeSize(finishSize(sizeBoxes, pattern).size, cat?.size_pattern ?? []);
    setCategoryId(id);
    if (cat && (isNew || !unitTouched)) setUnit(cat.default_unit);
  }

  const { size, missing } = finishSize(sizeBoxes, pattern);
  const preview = structured
    ? buildName(
        { category_id: categoryId, grade_id: gradeId, label_ids: labelIds, brand_id: brandId, mark_ids: markIds, size },
        dict,
      )
    : plainName.trim();
  const duplicate =
    structured &&
    products.some((p) => p.structured && p.id !== params.id && p.name.toUpperCase() === preview.toUpperCase());

  const minNum = Number(minStock.replace(',', '.'));
  let problem: string | null = null;
  if (structured && !categoryId) problem = 'Pick a category';
  else if (structured && missing.length) problem = `Fill in: ${missing.join(', ')}`;
  else if (!structured && !plainName.trim()) problem = 'Type a name';
  else if (duplicate) problem = 'This item already exists';
  else if (!(minNum >= 0)) problem = 'Min stock must be 0 or more';

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      await saveProduct(isNew ? null : params.id, {
        barcode,
        name: preview,
        unit,
        min_stock: minNum,
        is_active: active,
        category_id: categoryId,
        structured,
        grade_id: gradeId,
        brand_id: brandId,
        label_ids: labelIds,
        mark_ids: markIds,
        size,
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

  const boxes = pattern.length
    ? pattern
    : Array.from({ length: Math.min(5, Math.max(1, sizeBoxes.length + 1)) }, () => null);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isNew ? 'New item' : 'Item' }} />

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

      <Card style={{ borderColor: colors.primary }}>
        <Text style={styles.label}>Name</Text>
        <Text style={[styles.title, { fontSize: 18 }]}>{preview || '…'}</Text>
        {structured ? (
          <Text style={styles.muted}>Built from the parts below: Category Grade · Labels · Size · Brand Mark</Text>
        ) : (
          <Text style={{ color: colors.warn, fontWeight: '600' }}>Not structured: the name was typed by hand.</Text>
        )}
        {duplicate && <Text style={{ color: colors.out, fontWeight: '600' }}>This item already exists.</Text>}
      </Card>

      {!structured && editable && (
        <Button
          title="Split this name into parts"
          variant="outline"
          onPress={() => {
            fillFromText(plainName);
            setStructured(true);
          }}
        />
      )}
      {!structured && (
        <Field
          label="Name"
          value={plainName}
          onChangeText={setPlainName}
          editable={editable}
          autoCapitalize="characters"
        />
      )}

      {structured && (
        <>
          {notUnderstood.length > 0 && (
            <Text style={{ color: colors.warn }}>
              Not in the Recognition Table: {notUnderstood.join(' ')}. Add them there, or pick the parts below.
            </Text>
          )}
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipRow}>
              {[...data.categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .filter((c) => pickCategory || !categoryId || c.id === categoryId)
                .map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    active={categoryId === c.id}
                    onPress={() => {
                      if (!editable) return;
                      chooseCategory(c.id);
                      setPickCategory(false);
                    }}
                  />
                ))}
              {editable && categoryId && !pickCategory && (
                <Chip label="Change" active={false} color={colors.muted} onPress={() => setPickCategory(true)} />
              )}
              {editable && (
                <Chip
                  label="+ Recognition Table"
                  active={false}
                  color={colors.muted}
                  onPress={() => router.push('/recognition')}
                />
              )}
            </View>
          </View>

          {category && (
            <>
              <PartChips
                label="Grade"
                options={options('grade')}
                value={gradeId ? [gradeId] : []}
                onChange={(v) => setGradeId(v[0] ?? null)}
                disabled={!editable}
              />
              <PartChips
                label="Labels (up to 3, in order)"
                options={options('label')}
                common={used.label}
                value={labelIds}
                onChange={setLabelIds}
                multi
                disabled={!editable}
              />
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Size · {patternText(category.size_pattern ?? [])}</Text>
                {freeSize && (
                  <Text style={styles.muted}>
                    This size is written differently from the pattern, so it is shown box by box as saved.
                  </Text>
                )}
                <View style={[styles.row, { flexWrap: 'wrap' }]}>
                  {boxes.map((box, i) => (
                    <View key={i} style={{ minWidth: 96, flexGrow: 1, flexBasis: 96, gap: 2 }}>
                      <Text style={styles.muted}>
                        {box
                          ? `${box.name}${box.unit ? ` (${box.unit})` : ''}${box.optional ? ' · optional' : ''}`
                          : `Size ${i + 1}`}
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={sizeBoxes[i] ?? ''}
                        onChangeText={(v) =>
                          setSizeBoxes((s) => {
                            const next = [...s];
                            while (next.length < i) next.push('');
                            next[i] = v;
                            return next;
                          })
                        }
                        placeholder={box?.default ?? (box?.unit ? `e.g. 10${box.unit}` : '')}
                        placeholderTextColor={colors.muted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={editable}
                      />
                    </View>
                  ))}
                </View>
              </View>
              <PartChips
                label="Brand"
                options={options('brand')}
                common={used.brand}
                value={brandId ? [brandId] : []}
                onChange={(v) => setBrandId(v[0] ?? null)}
                disabled={!editable}
              />
              <PartChips
                label="Mark"
                options={data.terms
                  .filter((t) => t.kind === 'mark')
                  .map((t) => ({ id: t.id, name: t.meaning ? `${t.name}  ${t.meaning}` : t.name }))}
                value={markIds}
                onChange={setMarkIds}
                multi
                disabled={!editable}
              />
            </>
          )}
        </>
      )}

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Unit</Text>
        <View style={styles.chipRow}>
          {UNITS.map((u) => (
            <Chip
              key={u}
              label={u}
              active={unit === u}
              onPress={() => {
                if (!editable) return;
                setUnit(u);
                setUnitTouched(true);
              }}
            />
          ))}
          {!UNITS.includes(unit as (typeof UNITS)[number]) && (
            <Chip label={unit} active color={colors.muted} onPress={() => {}} />
          )}
        </View>
        <Text style={styles.muted}>Only KG takes decimals; the others are counted in whole numbers.</Text>
      </View>

      <View style={styles.row}>
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
      <View style={[styles.row, { alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Field
            label="Code / barcode (optional: one is given if empty)"
            value={barcode}
            onChangeText={setBarcode}
            autoCapitalize="none"
            autoCorrect={false}
            editable={editable}
          />
        </View>
        {editable && <Button title="Scan" variant="outline" onPress={() => setCamera(true)} />}
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={{ color: colors.text, fontSize: 16 }}>Active</Text>
        <Switch value={active} onValueChange={setActive} disabled={!editable} />
      </View>
      {editable && (
        <>
          {problem && <Text style={{ color: colors.out }}>{problem}</Text>}
          <Button title={isNew ? 'Create item' : 'Save changes'} onPress={save} loading={saving} disabled={!!problem} />
        </>
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
