import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { sizeNumbers, type Dictionary } from '../lib/recognize';
import { colors } from '../lib/theme';
import type { Product } from '../lib/types';
import { Chip, styles } from './ui';

type Facet = 'grade' | 'label' | 'size' | 'brand';
const FACETS: { key: Facet; label: string }[] = [
  { key: 'grade', label: 'Grade' },
  { key: 'label', label: 'Label' },
  { key: 'size', label: 'Size' },
  { key: 'brand', label: 'Brand' },
];

/** The values an item has for a facet (the size facet is its first size box, e.g. "10mm"). */
function values(p: Product, f: Facet): string[] {
  if (f === 'grade') return p.grade_id ? [p.grade_id] : ['-'];
  if (f === 'brand') return p.brand_id ? [p.brand_id] : ['-'];
  if (f === 'label') return p.label_ids?.length ? p.label_ids : ['-'];
  return p.size?.length ? [p.size[0]] : ['-'];
}

/**
 * Find an item by tapping: Category → Grade → Label → Size → Brand, narrowing the list each time.
 * Works without a scan, or starting from the category a scan found.
 */
export function ItemPicker({
  products,
  dict,
  onPick,
  startCategory = null,
}: {
  products: Product[];
  dict: Dictionary;
  onPick: (p: Product) => void;
  startCategory?: string | null;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(startCategory);
  const [picked, setPicked] = useState<Partial<Record<Facet, string>>>({});
  const [words, setWords] = useState('');

  const active = useMemo(() => products.filter((p) => p.is_active), [products]);
  const q = words.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const inCategory = active.filter(
    (p) =>
      (!categoryId || p.category_id === categoryId) &&
      q.every((w) => p.name.toLowerCase().includes(w) || p.barcode.toLowerCase().includes(w)),
  );
  const matches = (p: Product, except?: Facet) =>
    FACETS.every(({ key }) => key === except || !picked[key] || values(p, key).includes(picked[key]!));
  const shown = inCategory
    .filter((p) => matches(p))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const categoryCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of active) if (p.category_id) n.set(p.category_id, (n.get(p.category_id) ?? 0) + 1);
    return n;
  }, [active]);
  const categories = [...dict.categoryById.values()]
    .filter((c) => categoryCounts.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const name = (f: Facet, v: string) => (v === '-' ? 'None' : f === 'size' ? v : (dict.termById.get(v)?.name ?? '?'));
  /** Choices for a facet among the items that fit the other choices. */
  function choices(f: Facet) {
    const n = new Map<string, number>();
    for (const p of inCategory) if (matches(p, f)) for (const v of values(p, f)) n.set(v, (n.get(v) ?? 0) + 1);
    const list = [...n.entries()];
    if (f === 'size') {
      list.sort((a, b) => (sizeNumbers([a[0]])[0] ?? 0) - (sizeNumbers([b[0]])[0] ?? 0) || a[0].localeCompare(b[0]));
    } else list.sort((a, b) => name(f, a[0]).localeCompare(name(f, b[0])));
    // "None" first
    return [...list.filter(([v]) => v === '-'), ...list.filter(([v]) => v !== '-')];
  }

  return (
    <View style={{ gap: 10 }}>
      <TextInput
        style={styles.input}
        placeholder="Filter by words, e.g. ss400 10mm"
        placeholderTextColor={colors.muted}
        value={words}
        onChangeText={setWords}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Text style={styles.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip
          label="All"
          active={!categoryId}
          color={colors.muted}
          onPress={() => {
            setCategoryId(null);
            setPicked({});
          }}
        />
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={`${c.name} ${categoryCounts.get(c.id)}`}
            active={categoryId === c.id}
            onPress={() => {
              setCategoryId(c.id);
              setPicked({});
            }}
          />
        ))}
      </ScrollView>

      {categoryId &&
        FACETS.map(({ key, label }) => {
          const list = choices(key);
          if (list.length <= 1 && !picked[key]) return null;
          return (
            <View key={key} style={{ gap: 6 }}>
              <Text style={styles.label}>{label}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {picked[key] && (
                  <Chip
                    label="Any"
                    active={false}
                    color={colors.muted}
                    onPress={() => setPicked((p) => ({ ...p, [key]: undefined }))}
                  />
                )}
                {list.map(([v, n]) => (
                  <Chip
                    key={v}
                    label={`${name(key, v)} ${n}`}
                    active={picked[key] === v}
                    onPress={() => setPicked((p) => ({ ...p, [key]: p[key] === v ? undefined : v }))}
                  />
                ))}
              </ScrollView>
            </View>
          );
        })}

      <Text style={styles.muted}>
        {shown.length} item{shown.length === 1 ? '' : 's'}
        {shown.length > 30 ? ' · showing 30, narrow down above' : ''}
      </Text>
      {shown.slice(0, 30).map((p) => (
        <Pressable
          key={p.id}
          onPress={() => onPick(p)}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
        >
          <Text style={styles.title}>{p.name}</Text>
          <Text style={styles.muted}>
            {p.barcode} · {p.unit}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
