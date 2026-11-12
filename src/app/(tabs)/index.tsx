import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { compact, DailyColumns, RankedBars, StatTile, chart } from '../../components/charts';
import { Card, Chip, styles, Text } from '../../components/ui';
import {
  byCategory,
  scopeToCategory,
  type CategoryFilter,
  leastMoving,
  loadMonthStats,
  metricValue,
  mostMoving,
  movedItems,
  type Metric,
  type MonthStats,
} from '../../lib/stats';
import { colors, fs, layout, themed, type HomeKey } from '../../lib/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function HomeScreen() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [metric, setMetric] = useState<Metric>('qty');
  const [category, setCategory] = useState<CategoryFilter>(null);
  const [stats, setStats] = useState<MonthStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await loadMonthStats(ym.y, ym.m));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const shift = (d: number) =>
    setYm(({ y, m }) => {
      const date = new Date(y, m + d, 1);
      return { y: date.getFullYear(), m: date.getMonth() };
    });

  const dayLabel = useCallback((day: number) => `${MONTHS[ym.m]} ${day}`, [ym.m]);
  const wide = width >= 640;
  // Two item charts per row on wide screens (screen padding 16 + 16, gap 12).
  const itemCardWidth = wide ? (width - 32 - 12) / 2 : undefined;
  const unitOf = (unit: string) => (metric === 'qty' ? unit : 'moves');

  // Tiles, Top 5 lists and item charts follow the category filter; the category chart shows all.
  const scoped = useMemo(() => (stats ? scopeToCategory(stats, category) : null), [stats, category]);
  const top = useMemo(() => (scoped ? mostMoving(scoped, metric) : []), [scoped, metric]);
  const least = useMemo(() => (scoped ? leastMoving(scoped, metric) : []), [scoped, metric]);
  const moved = useMemo(() => (scoped ? movedItems(scoped, metric) : []), [scoped, metric]);
  const categoryRows = useMemo(
    () =>
      (stats ? byCategory(stats, metric) : []).map((c) => ({
        key: c.id,
        label: c.name,
        value: metricValue(c.total, metric),
        unit: metric === 'qty' ? 'units' : 'moves',
        onPress: () => setCategory(c.id),
      })),
    [stats, metric],
  );
  const categoryName =
    category === null
      ? null
      : category === 'none'
        ? 'Uncategorized'
        : (stats?.categories.find((c) => c.id === category)?.name ?? null);

  const toRows = (list: typeof top) =>
    list.map((i) => ({
      key: i.product.id,
      label: i.product.name,
      value: metricValue(i.total, metric),
      unit: unitOf(i.product.unit),
      onPress: () => router.push(`/product/${i.product.id}`),
    }));

  // Home sections in the order set in Theme & layout; Top 5 most / least sit side by side on wide
  // screens when they follow each other.
  const sections: HomeKey[][] = [];
  for (const s of layout.home.filter((x) => x.on)) {
    const last = sections[sections.length - 1];
    const pair = (a: HomeKey, b: HomeKey) => (a === 'top' && b === 'least') || (a === 'least' && b === 'top');
    if (wide && last?.length === 1 && pair(last[0], s.key)) last.push(s.key);
    else sections.push([s.key]);
  }

  function renderSection(key: HomeKey, i: number, group: HomeKey[]) {
    if (!stats || !scoped) return null;
    if (group.length === 2 && i === 1) return null; // drawn with the first of the pair
    if (group.length === 2) {
      return (
        <View key={key} style={{ flexDirection: 'row', gap: 12 }}>
          {group.map((k) => renderSection(k, 0, [k]))}
        </View>
      );
    }
    switch (key) {
      case 'tiles':
        return (
          <View key={key} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatTile
              label="Movements"
              value={compact(scoped.totalMoves)}
              note={isCurrentMonth ? 'this month' : 'in month'}
            />
            <StatTile
              label="Items moved"
              value={`${scoped.itemsMoved}`}
              note={`of ${scoped.items.filter((x) => x.product.is_active).length} products`}
            />
            <StatTile label="Low stock" value={`${scoped.lowStock}`} note="items at or below minimum, now" />
          </View>
        );
      case 'top':
        return (
          <Card key={key} style={{ flex: 1, gap: 12 }}>
            <Text style={styles.title}>Top 5 most moving</Text>
            <RankedBars rows={toRows(top)} emptyText="Nothing moved yet this month." />
          </Card>
        );
      case 'least':
        return (
          <Card key={key} style={{ flex: 1, gap: 12 }}>
            <Text style={styles.title}>Top 5 least moving</Text>
            <RankedBars rows={toRows(least)} emptyText="No products yet." />
          </Card>
        );
      case 'category':
        return (
          <Card key={key} style={{ gap: 12 }}>
            <View>
              <Text style={styles.title}>Movement by category</Text>
              <Text style={styles.muted}>
                {metric === 'qty' ? 'Quantity moved' : 'Times moved'} this month · tap a category to filter
              </Text>
            </View>
            <RankedBars rows={categoryRows} emptyText="No categories yet. Add them in Products → Recognition Table." />
          </Card>
        );
      case 'daily':
        return (
          <View key={key} style={{ gap: 12 }}>
            <Text style={[styles.title, { marginTop: 8 }]}>Daily movement</Text>
            <Card style={{ gap: 4 }}>
              <Text style={styles.title}>{categoryName ? `All ${categoryName} items` : 'All items'}</Text>
              <Text style={styles.muted}>Number of movements per day</Text>
              <DailyColumns days={scoped.allDays} metric="times" monthLabel={dayLabel} height={120} />
            </Card>
          </View>
        );
      case 'items':
        return moved.length === 0 ? (
          <Text key={key} style={styles.muted}>
            Item charts appear here once stock moves this month.
          </Text>
        ) : (
          <View key={key} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {moved.map((x) => (
              <Card key={x.product.id} style={{ width: itemCardWidth ?? '100%', gap: 4 }}>
                <Pressable onPress={() => router.push(`/product/${x.product.id}`)}>
                  <Text style={styles.title} numberOfLines={1}>
                    {x.product.name}
                  </Text>
                  <Text style={styles.muted}>
                    {formatTotal(metricValue(x.total, metric), unitOf(x.product.unit))} this month
                  </Text>
                </Pressable>
                <DailyColumns days={x.days} metric={metric} unit={x.product.unit} monthLabel={dayLabel} />
              </Card>
            ))}
          </View>
        );
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.pad, { paddingBottom: 32 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {/* Month (stats reset every month) + metric */}
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }]}>
        <View style={styles.row}>
          <Pressable onPress={() => shift(-1)} style={navBtn} accessibilityLabel="Previous month" hitSlop={8}>
            <Text style={navText}>‹</Text>
          </Pressable>
          <Text style={[styles.title, { fontSize: fs(20), minWidth: 150, textAlign: 'center' }]}>
            {MONTHS_LONG[ym.m]} {ym.y}
          </Text>
          <Pressable
            onPress={() => shift(1)}
            disabled={isCurrentMonth}
            style={[navBtn, isCurrentMonth && { opacity: 0.3 }]}
            accessibilityLabel="Next month"
            hitSlop={8}
          >
            <Text style={navText}>›</Text>
          </Pressable>
        </View>
        <View style={styles.chipRow}>
          <Chip label="Qty" active={metric === 'qty'} onPress={() => setMetric('qty')} />
          <Chip label="Times" active={metric === 'times'} onPress={() => setMetric('times')} />
        </View>
      </View>
      <Text style={styles.muted}>
        {metric === 'qty'
          ? 'Ranked by quantity moved (in + out + transfer) this month.'
          : 'Ranked by how many times an item moved this month.'}{' '}
        Stock counts (Adjust) are not counted.
      </Text>

      {error && <Text style={{ color: colors.out }}>{error}</Text>}

      {stats && stats.categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip label="All categories" active={category === null} onPress={() => setCategory(null)} />
          {stats.categories.map((c) => (
            <Chip key={c.id} label={c.name} active={category === c.id} onPress={() => setCategory(c.id)} />
          ))}
          <Chip label="Uncategorized" active={category === 'none'} onPress={() => setCategory('none')} />
        </ScrollView>
      )}

      {stats && scoped && <View style={{ gap: 12 }}>{sections.map((group) => group.map(renderSection))}</View>}
    </ScrollView>
  );
}

function formatTotal(v: number, unit: string) {
  return `${compact(v)} ${unit}`;
}

const navBtn = themed(() => ({
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}));
const navText = themed(() => ({ fontSize: fs(22), color: chart.ink, marginTop: -2 }));
