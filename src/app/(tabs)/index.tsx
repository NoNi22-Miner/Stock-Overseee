import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { compact, DailyColumns, RankedBars, StatTile, chart } from '../../components/charts';
import { Card, Chip, styles } from '../../components/ui';
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
import { colors } from '../../lib/theme';

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
          <Text style={[styles.title, { fontSize: 20, minWidth: 150, textAlign: 'center' }]}>
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

      {stats && scoped && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatTile
              label="Movements"
              value={compact(scoped.totalMoves)}
              note={isCurrentMonth ? 'this month' : 'in month'}
            />
            <StatTile
              label="Items moved"
              value={`${scoped.itemsMoved}`}
              note={`of ${scoped.items.filter((i) => i.product.is_active).length} products`}
            />
            <StatTile label="Low stock" value={`${scoped.lowStock}`} note="items at or below minimum, now" />
          </View>

          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12 }}>
            <Card style={{ flex: 1, gap: 12 }}>
              <Text style={styles.title}>Top 5 most moving</Text>
              <RankedBars rows={toRows(top)} emptyText="Nothing moved yet this month." />
            </Card>
            <Card style={{ flex: 1, gap: 12 }}>
              <Text style={styles.title}>Top 5 least moving</Text>
              <RankedBars rows={toRows(least)} emptyText="No products yet." />
            </Card>
          </View>

          <Card style={{ gap: 12 }}>
            <View>
              <Text style={styles.title}>Movement by category</Text>
              <Text style={styles.muted}>
                {metric === 'qty' ? 'Quantity moved' : 'Times moved'} this month · tap a category to filter
              </Text>
            </View>
            <RankedBars rows={categoryRows} emptyText="No categories yet. Add them in Products → Categories." />
          </Card>

          <Text style={[styles.title, { marginTop: 8 }]}>Daily movement</Text>
          <Card style={{ gap: 4 }}>
            <Text style={styles.title}>{categoryName ? `All ${categoryName} items` : 'All items'}</Text>
            <Text style={styles.muted}>Number of movements per day</Text>
            <DailyColumns days={scoped.allDays} metric="times" monthLabel={dayLabel} height={120} />
          </Card>

          {moved.length === 0 ? (
            <Text style={styles.muted}>Item charts appear here once stock moves this month.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {moved.map((i) => (
                <Card key={i.product.id} style={{ width: itemCardWidth ?? '100%', gap: 4 }}>
                  <Pressable onPress={() => router.push(`/product/${i.product.id}`)}>
                    <Text style={styles.title} numberOfLines={1}>
                      {i.product.name}
                    </Text>
                    <Text style={styles.muted}>
                      {formatTotal(metricValue(i.total, metric), unitOf(i.product.unit))} this month
                    </Text>
                  </Pressable>
                  <DailyColumns days={i.days} metric={metric} unit={i.product.unit} monthLabel={dayLabel} />
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function formatTotal(v: number, unit: string) {
  return `${compact(v)} ${unit}`;
}

const navBtn = {
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
const navText = { fontSize: 22, color: chart.ink, marginTop: -2 };
