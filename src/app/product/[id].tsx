import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { HistoryItem } from '../../components/HistoryList';
import { PartChips, type ChipOption } from '../../components/PartChips';
import { Button, Card, Chip, Field, styles, Text } from '../../components/ui';
import { formatQty, getProduct, listHistory, listProducts, saveProduct, stockForProducts } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { defaultGradeTerm, gradeList, gradeName, gradeVersions, mappedGradeId } from '../../lib/grades';
import { cached } from '../../lib/offline';
import { useRecognition } from '../../lib/recognition';
import { buildName, finishSize, fitToPattern, patternText, splitName, UNITS, type Dictionary, type Parts } from '../../lib/recognize';
import { can } from '../../lib/roles';
import { colors, fs } from '../../lib/theme';
import type { MovementRow, Product, SizeBox, StockRow, Term, TermKind } from '../../lib/types';

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
  const [gradeNote, setGradeNote] = useState('');
  /** A new item follows the standard grade (or a recognition entry) until someone picks a grade. */
  const [gradeTouched, setGradeTouched] = useState(!isNew);
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
  const [familyStock, setFamilyStock] = useState<StockRow[]>([]);
  /** A grade to create beside this one, without renaming the open item. */
  const [addGradeId, setAddGradeId] = useState<string | null>(null);
  const [addRemark, setAddRemark] = useState('');
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<MovementRow[]>([]);
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The item as it was loaded (to see which parts changed). */
  const [loaded, setLoaded] = useState<Product | null>(null);

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

  const standard = useMemo(
    () => defaultGradeTerm(data.terms, data.defaultGradeId),
    [data.terms, data.defaultGradeId],
  );

  /** Fill the parts from a name (an old typed name, or text read by the camera). */
  function fillFromText(text: string) {
    const r = splitName(text, dict, true);
    setCategoryId(r.categoryId);
    setLabelIds(r.labelIds);
    setBrandId(r.brandId);
    setMarkIds(r.markIds);
    const resolved = r.gradeId ?? mappedGradeId(r, dict) ?? standard?.id ?? null;
    setGradeId(resolved);
    setGradeTouched(true);
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
    Promise.all([getProduct(params.id), stockForProducts([params.id]), listHistory({ productId: params.id, limit: 30 })])
      .then(([p, s, h]) => {
        setLoaded(p);
        setBarcode(p.barcode);
        setPlainName(p.name);
        setStructured(p.structured);
        setCategoryId(p.category_id);
        setGradeId(p.grade_id);
        setGradeNote(p.grade_note ?? '');
        setGradeTouched(true);
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
        setFamilyStock(s);
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
  const formParts: Parts = {
    categoryId,
    gradeId: null,
    labelIds,
    brandId,
    markIds,
    size: [],
    unknown: [],
    extraBrands: [],
    sizeDoubt: false,
  };
  const suggested = mappedGradeId(formParts, dict);
  // A new item stays on the standard grade, or on a grade a recognition entry assigns, until a grade is picked.
  const chosenGrade = isNew && !gradeTouched ? (suggested ?? standard?.id ?? null) : gradeId;
  const needsRemark = structured && !!standard && chosenGrade !== standard.id;
  const preview = structured
    ? buildName(
        {
          category_id: categoryId,
          grade_id: chosenGrade,
          label_ids: labelIds,
          brand_id: brandId,
          mark_ids: markIds,
          size,
        },
        dict,
      )
    : plainName.trim();
  const duplicate =
    structured &&
    products.some((p) => p.structured && p.id !== params.id && p.name.toUpperCase() === preview.toUpperCase());

  // The other grade versions of this item (same parts, another grade).
  const versions = useMemo(
    () => (loaded?.structured ? gradeVersions(products, loaded, dict) : []),
    [loaded, products, dict],
  );
  const versionKey = versions.map((v) => v.id).join(',');
  useEffect(() => {
    if (isNew || !versionKey) return;
    let alive = true;
    stockForProducts(versionKey.split(','))
      .then((rows) => {
        if (!alive) return;
        setFamilyStock(rows);
        setStock(rows.filter((r) => r.product_id === params.id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isNew, versionKey, params.id]);
  const siblings = versions.filter((v) => v.id !== loaded?.id);
  const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);
  const partsChanged =
    !!loaded &&
    structured &&
    (loaded.category_id !== categoryId ||
      loaded.brand_id !== brandId ||
      loaded.unit !== unit ||
      !sameList(loaded.label_ids, labelIds) ||
      !sameList(loaded.mark_ids, markIds) ||
      !sameList(
        loaded.size?.map((x) => x.toUpperCase()),
        size.map((x) => x.toUpperCase()),
      ));
  const followers = partsChanged ? siblings : [];

  const minNum = Number(minStock.replace(',', '.'));
  let problem: string | null = null;
  if (structured && !categoryId) problem = 'Pick a category';
  else if (structured && missing.length) problem = `Fill in: ${missing.join(', ')}`;
  else if (!structured && !plainName.trim()) problem = 'Type a name';
  else if (duplicate) problem = 'This item already exists';
  else if (!(minNum >= 0)) problem = 'Min stock must be 0 or more';

  async function addSibling() {
    if (!loaded?.structured || !addGradeId) return;
    const exists = versions.some((v) => v.grade_id === addGradeId);
    if (exists) {
      const other = versions.find((v) => v.grade_id === addGradeId);
      if (other) router.replace(`/product/${other.id}`);
      return;
    }
    setAdding(true);
    try {
      const created = await saveProduct(null, {
        barcode: '',
        name: loaded.name,
        unit: loaded.unit,
        min_stock: 0,
        is_active: loaded.is_active,
        category_id: loaded.category_id,
        structured: true,
        grade_id: addGradeId,
        grade_note: standard && addGradeId !== standard.id ? addRemark.trim() || null : null,
        brand_id: loaded.brand_id,
        label_ids: loaded.label_ids ?? [],
        mark_ids: loaded.mark_ids ?? [],
        size: loaded.size ?? [],
      });
      const fresh = await listProducts().catch(() => null);
      if (fresh) setProducts(fresh);
      router.replace(`/product/${created.id}`);
    } catch (e) {
      Alert.alert('Could not add grade', (e as Error).message);
    } finally {
      setAdding(false);
    }
  }

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
        grade_id: chosenGrade,
        grade_note: needsRemark ? gradeNote.trim() || null : null,
        brand_id: brandId,
        label_ids: labelIds,
        mark_ids: markIds,
        size,
      });
      // The other grades of this item get the same parts and unit (each keeps its grade and code).
      const failed: string[] = [];
      for (const v of followers) {
        try {
          await saveProduct(v.id, {
            ...v,
            unit,
            category_id: categoryId,
            structured: true,
            brand_id: brandId,
            label_ids: labelIds,
            mark_ids: markIds,
            size,
          });
        } catch (e) {
          failed.push(`${v.name}: ${(e as Error).message}`);
        }
      }
      if (failed.length) Alert.alert('Saved, but some grades were not changed', failed.join('\n'));
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
              <Text key={s.location_id} style={{ fontSize: fs(16), color: s.is_low ? colors.warn : colors.text }}>
                {s.location_code}: <Text style={{ fontWeight: '800' }}>{formatQty(s.qty)}</Text> {s.unit}
                {s.is_low ? ' (low)' : ''}
              </Text>
            ))}
          </View>
        </Card>
      )}

      {loaded?.structured && (
        <GradeTable
          versions={versions}
          stock={familyStock}
          dict={dict}
          currentId={loaded.id}
          unit={loaded.unit}
          editable={editable}
          missing={gradeList(data.terms).filter((g) => !versions.some((v) => v.grade_id === g.id))}
          addGradeId={addGradeId}
          addRemark={addRemark}
          standardId={standard?.id ?? null}
          standardName={standard?.name ?? 'B'}
          adding={adding}
          onOpen={(id) => id !== loaded.id && router.replace(`/product/${id}`)}
          onPickAdd={setAddGradeId}
          onRemark={setAddRemark}
          onAdd={addSibling}
        />
      )}

      <Card style={{ borderColor: colors.primary }}>
        <Text style={styles.label}>Name</Text>
        <Text style={[styles.title, { fontSize: fs(18) }]}>{preview || '…'}</Text>
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
                value={chosenGrade ? [chosenGrade] : []}
                onChange={(v) => {
                  const id = v[0] ?? null;
                  if (!isNew && loaded) {
                    if (!id || id === loaded.grade_id) return;
                    const other = versions.find((x) => x.grade_id === id);
                    if (other) {
                      router.replace(`/product/${other.id}`);
                      return;
                    }
                    setAddGradeId(id);
                    return;
                  }
                  setGradeTouched(true);
                  setGradeId(id);
                }}
                disabled={!editable}
              />
              {standard && (
                <Text style={styles.muted}>
                  Standard grade: {standard.name}. A recognition entry can assign another. Any other grade can take a
                  remark.
                </Text>
              )}
              {editable && suggested && suggested !== chosenGrade && (
                <View style={styles.row}>
                  <Text style={{ color: colors.text, flex: 1 }}>
                    Recognition assigns grade {gradeName(suggested, dict)}
                  </Text>
                  <Chip
                    label="Use it"
                    active={false}
                    onPress={() => {
                      if (!isNew && loaded) {
                        const other = versions.find((x) => x.grade_id === suggested);
                        if (other) router.replace(`/product/${other.id}`);
                        else setAddGradeId(suggested);
                        return;
                      }
                      setGradeTouched(true);
                      setGradeId(suggested);
                    }}
                  />
                </View>
              )}
              {needsRemark && editable && (
                <Field
                  label={`Note / Remark for grade ${gradeName(chosenGrade, dict)}`}
                  value={gradeNote}
                  onChangeText={setGradeNote}
                  placeholder={`Why this is not the standard grade ${standard?.name ?? ''}`}
                  maxLength={400}
                />
              )}
              {needsRemark && !editable && !!gradeNote.trim() && (
                <Text style={{ color: colors.text }}>Remark: {gradeNote}</Text>
              )}
              {!needsRemark && !!gradeNote.trim() && <Text style={styles.muted}>Remark: {gradeNote}</Text>}
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
        <Text style={{ color: colors.text, fontSize: fs(16) }}>Active</Text>
        <Switch value={active} onValueChange={setActive} disabled={!editable} />
      </View>
      {editable && (
        <>
          {problem && <Text style={{ color: colors.out }}>{problem}</Text>}
          {followers.length > 0 && (
            <Text style={styles.muted}>
              The other grades of this item get the same changes:{' '}
              {followers.map((v) => gradeName(v.grade_id, dict)).join(', ')}
            </Text>
          )}
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

/** Every grade of this item, with its quantity and remark, and a way to add another grade beside it. */
function GradeTable({
  versions,
  stock,
  dict,
  currentId,
  unit,
  editable,
  missing,
  addGradeId,
  addRemark,
  standardId,
  standardName,
  adding,
  onOpen,
  onPickAdd,
  onRemark,
  onAdd,
}: {
  versions: Product[];
  stock: StockRow[];
  dict: Dictionary;
  currentId: string;
  unit: string;
  editable: boolean;
  missing: Term[];
  addGradeId: string | null;
  addRemark: string;
  standardId: string | null;
  standardName: string;
  adding: boolean;
  onOpen: (id: string) => void;
  onPickAdd: (id: string | null) => void;
  onRemark: (text: string) => void;
  onAdd: () => void;
}) {
  const locations = [...new Map(stock.map((s) => [s.location_id, s.location_code])).entries()];
  const rows = versions.map((v) => {
    const mine = stock.filter((s) => s.product_id === v.id);
    const byLoc = new Map(mine.map((s) => [s.location_id, s.qty]));
    const total = mine.reduce((n, s) => n + s.qty, 0);
    return { v, byLoc, total };
  });
  const needsRemark = !!addGradeId && addGradeId !== standardId;
  return (
    <Card style={{ gap: 8 }}>
      <Text style={styles.label}>Grades of this item</Text>
      {rows.map(({ v, byLoc, total }) => {
        const here = v.id === currentId;
        return (
          <Pressable
            key={v.id}
            onPress={() => onOpen(v.id)}
            style={{
              gap: 2,
              borderWidth: 1,
              borderColor: here ? colors.primary : colors.border,
              borderRadius: 10,
              padding: 8,
            }}
          >
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>
                {gradeName(v.grade_id, dict)}
                {here ? ' · this one' : ''}
              </Text>
              <Text style={{ color: colors.text, fontWeight: '800' }}>
                {formatQty(total)} {unit}
              </Text>
            </View>
            {locations.length > 1 && (
              <Text style={styles.muted}>
                {locations.map(([id, code]) => `${code} ${formatQty(byLoc.get(id) ?? 0)}`).join('  ·  ')}
              </Text>
            )}
            {locations.length === 1 && (
              <Text style={styles.muted}>
                {locations[0][1]} {formatQty(byLoc.get(locations[0][0]) ?? 0)}
              </Text>
            )}
            <Text style={styles.muted}>{v.barcode}{v.is_active ? '' : ' · inactive'}</Text>
            {!!v.grade_note && <Text style={{ color: colors.text }}>Remark: {v.grade_note}</Text>}
          </Pressable>
        );
      })}
      <Text style={styles.muted}>
        Each grade has its own code and stock. Tap a grade to open it. Adding a grade keeps this one as it is.
      </Text>
      {editable && missing.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Add a grade</Text>
          <View style={styles.chipRow}>
            {missing.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                active={addGradeId === g.id}
                onPress={() => onPickAdd(addGradeId === g.id ? null : g.id)}
              />
            ))}
          </View>
          {needsRemark && (
            <Field
              label={`Note / Remark for grade ${gradeName(addGradeId, dict)}`}
              value={addRemark}
              onChangeText={onRemark}
              placeholder={`Why this is not the standard grade ${standardName}`}
              maxLength={400}
            />
          )}
          {addGradeId && (
            <Button
              title={`Add grade ${gradeName(addGradeId, dict)}`}
              onPress={onAdd}
              loading={adding}
            />
          )}
        </View>
      )}
    </Card>
  );
}
