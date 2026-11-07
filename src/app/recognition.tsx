import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, Chip, Field, styles } from '../components/ui';
import { deleteCategory, deleteTerm, listProducts, saveCategory, saveTerm } from '../lib/api';
import { useRole } from '../lib/auth';
import { cached } from '../lib/offline';
import { useRecognition } from '../lib/recognition';
import { patternText, UNITS } from '../lib/recognize';
import { can } from '../lib/roles';
import { colors } from '../lib/theme';
import type { Category, Product, SizeBox, Term, TermKind } from '../lib/types';

type Tab = 'category' | TermKind;
const TABS: { key: Tab; label: string; one: string; hint: string }[] = [
  { key: 'category', label: 'Categories', one: 'category', hint: 'e.g. PLAT BESI, BESI BETON ULIR' },
  { key: 'grade', label: 'Grades', one: 'grade', hint: 'e.g. A, B, C' },
  { key: 'label', label: 'Labels', one: 'label', hint: 'Standard / spec, e.g. SS400, U-280, SCH40' },
  { key: 'brand', label: 'Brands', one: 'brand', hint: 'e.g. KP, AS-T, VM' },
  { key: 'mark', label: 'Marks', one: 'mark', hint: 'e.g. * (other quality), NS (non standard)' },
];

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

type Draft = { id: string | null; name: string; aliases: string; meaning: string; unit: string; pattern: SizeBox[] };

const emptyDraft = (unit = 'Pcs'): Draft => ({ id: null, name: '', aliases: '', meaning: '', unit, pattern: [] });

/** Team Leader / Oversee: the lists items are built from. Everyone else can look. */
export default function RecognitionScreen() {
  const manage = can.manageProducts(useRole());
  const { data, reload, error } = useRecognition();
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<Tab>('category');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      reload();
      cached('products', listProducts)
        .then((r) => setProducts(r.value))
        .catch(() => {});
    }, [reload]),
  );

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    const add = (id: string | null | undefined) => id && n.set(id, (n.get(id) ?? 0) + 1);
    for (const p of products) {
      add(p.category_id);
      add(p.grade_id);
      add(p.brand_id);
      (p.label_ids ?? []).forEach(add);
      (p.mark_ids ?? []).forEach(add);
    }
    return n;
  }, [products]);

  const info = TABS.find((t) => t.key === tab)!;
  const q = search.trim().toUpperCase();
  const entries: (Category | Term)[] = (tab === 'category' ? data.categories : data.terms.filter((t) => t.kind === tab))
    .filter((e) => !q || e.name.toUpperCase().includes(q) || (e.aliases ?? []).some((a) => a.toUpperCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  function edit(e: Category | Term) {
    if (!manage) return;
    const c = tab === 'category' ? (e as Category) : null;
    setDraft({
      id: e.id,
      name: e.name,
      aliases: (e.aliases ?? []).join(', '),
      meaning: c ? '' : ((e as Term).meaning ?? ''),
      unit: c?.default_unit ?? 'Pcs',
      pattern: c ? (c.size_pattern ?? []).map((b) => ({ ...b })) : [],
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      if (tab === 'category') {
        await saveCategory(draft.id, {
          name: draft.name,
          aliases: splitList(draft.aliases),
          default_unit: draft.unit,
          size_pattern: draft.pattern
            .map((b) => ({
              name: b.name.trim(),
              ...(b.unit?.trim() ? { unit: b.unit.trim() } : {}),
              ...(b.optional ? { optional: true } : {}),
              ...(b.default?.trim() ? { default: b.default.trim() } : {}),
            }))
            .filter((b) => b.name),
        });
      } else {
        await saveTerm(draft.id, {
          kind: tab,
          name: draft.name,
          aliases: splitList(draft.aliases),
          meaning: draft.meaning.trim() || null,
        });
      }
      setDraft(null);
      await reload();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!draft?.id) return;
    const id = draft.id;
    Alert.alert(`Delete ${draft.name}?`, 'It can only be deleted when no item uses it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await (tab === 'category' ? deleteCategory(id) : deleteTerm(id));
            setDraft(null);
            await reload();
          } catch (e) {
            Alert.alert('Could not delete', (e as Error).message);
          }
        },
      },
    ]);
  }

  const setBox = (i: number, patch: Partial<SizeBox>) =>
    setDraft((d) => d && { ...d, pattern: d.pattern.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const editor = draft && (
    <Card style={{ gap: 10, borderColor: colors.primary }}>
      <Text style={styles.title}>{draft.id ? `Edit ${info.one}` : `New ${info.one}`}</Text>
      <Field
        label="Name"
        value={draft.name}
        onChangeText={(name) => setDraft({ ...draft, name })}
        autoCapitalize="characters"
        placeholder={info.hint}
        maxLength={tab === 'category' ? 60 : 40}
      />
      <Field
        label="Other spellings on paper (comma between)"
        value={draft.aliases}
        onChangeText={(aliases) => setDraft({ ...draft, aliases })}
        autoCapitalize="characters"
        placeholder={tab === 'category' ? 'e.g. BB ULIR, BESI ULIR' : 'e.g. U280, U 280'}
      />
      {tab !== 'category' && (
        <Field
          label="Meaning (optional)"
          value={draft.meaning}
          onChangeText={(meaning) => setDraft({ ...draft, meaning })}
          maxLength={120}
        />
      )}
      {tab === 'category' && (
        <>
          <Text style={styles.label}>Default unit</Text>
          <View style={styles.chipRow}>
            {UNITS.map((u) => (
              <Chip key={u} label={u} active={draft.unit === u} onPress={() => setDraft({ ...draft, unit: u })} />
            ))}
          </View>
          <Text style={styles.label}>Size pattern (up to 5 boxes, in the order written on paper)</Text>
          {draft.pattern.map((b, i) => (
            <View key={i} style={{ gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8 }}>
              <View style={styles.row}>
                <Text style={[styles.muted, { width: 18 }]}>{i + 1}.</Text>
                <TextInput
                  style={[styles.input, { flex: 1, minWidth: 0 }]}
                  value={b.name}
                  onChangeText={(name) => setBox(i, { name })}
                  placeholder="Box name, e.g. Tebal"
                  placeholderTextColor={colors.muted}
                />
                <TextInput
                  style={[styles.input, { width: 64 }]}
                  value={b.unit ?? ''}
                  onChangeText={(unit) => setBox(i, { unit })}
                  placeholder="unit"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                />
                <Pressable
                  hitSlop={8}
                  onPress={() => setDraft({ ...draft, pattern: draft.pattern.filter((_, j) => j !== i) })}
                >
                  <Text style={{ color: colors.out, fontWeight: '800', fontSize: 18 }}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1, minWidth: 0 }]}
                  value={b.default ?? ''}
                  onChangeText={(v) => setBox(i, { default: v })}
                  placeholder="If left out, use… (e.g. 6m)"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                />
                <Text style={styles.muted}>Optional</Text>
                <Switch value={!!b.optional} onValueChange={(optional) => setBox(i, { optional })} />
              </View>
            </View>
          ))}
          {draft.pattern.length < 5 && (
            <Button
              title="+ Add size box"
              variant="outline"
              onPress={() => setDraft({ ...draft, pattern: [...draft.pattern, { name: '' }] })}
            />
          )}
          <Text style={styles.muted}>
            {
              'A unit (mm, m, " or \') is added when only a number is typed. "If left out" fills the last box when an item size does not have it, e.g. Panjang 6m.'
            }
          </Text>
        </>
      )}
      <View style={styles.row}>
        <Button title="Save" style={{ flex: 1 }} onPress={save} loading={busy} disabled={!draft.name.trim()} />
        <Button
          title="Cancel"
          variant="outline"
          color={colors.muted}
          style={{ flex: 1 }}
          onPress={() => setDraft(null)}
        />
      </View>
      {draft.id && <Button title="Delete" variant="outline" color={colors.out} onPress={remove} />}
    </Card>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}
      keyboardShouldPersistTaps="handled"
      data={draft ? [] : entries}
      keyExtractor={(e) => e.id}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {TABS.map((t) => (
              <Chip
                key={t.key}
                label={`${t.label} ${t.key === 'category' ? data.categories.length : data.terms.filter((x) => x.kind === t.key).length}`}
                active={tab === t.key}
                onPress={() => {
                  setTab(t.key);
                  setDraft(null);
                  setSearch('');
                }}
              />
            ))}
          </ScrollView>
          <Text style={styles.muted}>
            Items are named from these lists: Category Grade · Labels · Size · Brand Mark. Other spellings help the
            camera and the Excel import recognise paperwork.
          </Text>
          {error && <Text style={{ color: colors.out }}>{error}</Text>}
          {editor}
          {!draft && (
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Search ${info.label.toLowerCase()}`}
                placeholderTextColor={colors.muted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="characters"
              />
              {manage && <Button title="+ Add" onPress={() => setDraft(emptyDraft())} />}
            </View>
          )}
        </View>
      }
      ListEmptyComponent={draft ? undefined : <Text style={styles.empty}>Nothing here yet.</Text>}
      renderItem={({ item }) => {
        const c = tab === 'category' ? (item as Category) : null;
        const t = c ? null : (item as Term);
        const n = counts.get(item.id) ?? 0;
        return (
          <Pressable
            onPress={() => edit(item)}
            style={({ pressed }) => [styles.card, pressed && manage && { opacity: 0.7 }]}
          >
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { flex: 1 }]}>{item.name}</Text>
              <Text style={styles.muted}>
                {n} item{n === 1 ? '' : 's'}
              </Text>
            </View>
            {!!item.aliases?.length && <Text style={styles.muted}>Also: {item.aliases.join(', ')}</Text>}
            {t?.meaning && <Text style={{ color: colors.text }}>{t.meaning}</Text>}
            {c && (
              <Text style={{ color: colors.text }}>
                {patternText(c.size_pattern ?? [])} · {c.default_unit}
              </Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}
