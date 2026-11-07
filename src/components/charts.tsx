// Small, dependency-free charts drawn with Views.
// Specs: one hue, bars <= 24px with a 4px rounded data end (square at the baseline),
// a 2px gap between touching columns, hairline gridlines, text in ink colors only.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { chart, colors, themed } from '../lib/theme';
import { formatQty } from '../lib/api';
import type { DayStat, Metric } from '../lib/stats';

export { chart };

/** Round up to 1, 2, 2.5 or 5 × 10^n so axis ticks are clean numbers. */
export function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

export function compact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${formatQty(Math.round(n / 100_000) / 10)}M`;
  if (Math.abs(n) >= 10_000) return `${formatQty(Math.round(n / 100) / 10)}K`;
  return formatQty(Math.round(n * 1000) / 1000);
}

// Stat tile ----------------------------------------------------------------------

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={s.tile} accessible accessibilityLabel={`${label}: ${value}${note ? `, ${note}` : ''}`}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={s.tileValue}>{value}</Text>
      {note && <Text style={s.tileNote}>{note}</Text>}
    </View>
  );
}

// Ranked horizontal bars --------------------------------------------------------------

export type RankedRow = { key: string; label: string; value: number; unit?: string; onPress?: () => void };

export function RankedBars({ rows, emptyText }: { rows: RankedRow[]; emptyText: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return <Text style={s.empty}>{emptyText}</Text>;
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => {
        const share = max > 0 ? r.value / max : 0;
        return (
          <Pressable
            key={r.key}
            onPress={r.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}. ${r.label}: ${formatQty(r.value)}${r.unit ? ` ${r.unit}` : ''}`}
            style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.rankLabel} numberOfLines={1}>
              <Text style={s.rankNo}>{i + 1}. </Text>
              {r.label}
            </Text>
            {/* Longest bar takes 75% of the row, leaving room for the value at its tip. */}
            <View style={s.rankBarRow}>
              {r.value > 0 && <View style={[s.rankBar, { width: `${share * 75}%` }]} />}
              <Text style={s.rankValue}>
                {compact(r.value)}
                {r.unit ? <Text style={s.rankUnit}> {r.unit}</Text> : null}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// Daily columns (one per day of the month) ----------------------------------------

const Y_AXIS_W = 34;

export function DailyColumns({
  days,
  metric,
  unit,
  monthLabel,
  height = 96,
}: {
  days: DayStat[];
  metric: Metric;
  unit?: string;
  monthLabel: (day: number) => string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const values = days.map((d) => (metric === 'qty' ? d.qty : d.times));
  const total = values.reduce((a, b) => a + b, 0);
  const top = niceMax(Math.max(...values, 0));
  const plotW = Math.max(0, width - Y_AXIS_W);
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const unitText = metric === 'qty' ? (unit ?? '') : 'moves';

  const busiest = values.indexOf(Math.max(...values));
  const summary =
    total > 0
      ? `Total ${formatQty(total)} ${unitText}. Busiest day ${monthLabel(busiest + 1)} with ${formatQty(values[busiest])}.`
      : 'No movement this month.';

  const sel = selected != null ? days[selected] : null;
  const readout = sel
    ? `${monthLabel(selected! + 1)}: ${formatQty(values[selected!])} ${unitText}` +
      (metric === 'qty'
        ? `  (in ${formatQty(sel.in)} · out ${formatQty(sel.out)} · transfer ${formatQty(sel.transfer)})`
        : `  (${formatQty(sel.qty)} units)`)
    : `Total ${formatQty(total)} ${unitText} · tap a day for details`;

  const ticks = [1, 8, 15, 22, 29].filter((d) => d <= days.length);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={summary}
    >
      <Text style={s.readout} numberOfLines={2}>
        {readout}
      </Text>
      <View style={{ height, flexDirection: 'row' }}>
        {/* Y axis labels */}
        <View style={{ width: Y_AXIS_W, height }}>
          {[top, top / 2, 0].map((t, i) => (
            <Text key={i} style={[s.yTick, { top: (i * height) / 2 - 7 }]}>
              {compact(t)}
            </Text>
          ))}
        </View>
        {/* Plot */}
        <View style={{ flex: 1, height }}>
          {[0, 0.5].map((f) => (
            <View key={f} style={[s.grid, { top: f * height }]} />
          ))}
          <View style={[s.baseline, { top: height - 1 }]} />
          <View style={{ flexDirection: 'row', height, alignItems: 'flex-end' }}>
            {values.map((v, i) => {
              const h = v > 0 ? Math.max(2, (v / top) * height) : 0;
              const r = Math.min(4, h / 2, barW / 2);
              return (
                <Pressable
                  key={i}
                  onPress={() => setSelected(selected === i ? null : i)}
                  style={{ width: slot, height, justifyContent: 'flex-end', alignItems: 'center' }}
                  hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityLabel={`${monthLabel(i + 1)}: ${formatQty(v)} ${unitText}`}
                >
                  {h > 0 && (
                    <View
                      style={{
                        width: barW,
                        height: h,
                        backgroundColor: selected === i ? chart.barActive : chart.bar,
                        borderTopLeftRadius: r,
                        borderTopRightRadius: r,
                      }}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      {/* X axis day labels */}
      <View style={{ height: 16, marginLeft: Y_AXIS_W }}>
        {ticks.map((d) => (
          <Text key={d} style={[s.xTick, { left: (d - 0.5) * slot - 12 }]}>
            {d}
          </Text>
        ))}
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    tile: {
      flexGrow: 1,
      flexBasis: 140,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 2,
    },
    tileLabel: { color: chart.inkSecondary, fontSize: 13, fontWeight: '600' },
    tileValue: { color: chart.ink, fontSize: 26, fontWeight: '700' },
    tileNote: { color: chart.inkMuted, fontSize: 12 },
    empty: { color: chart.inkMuted, paddingVertical: 12 },
    rankLabel: { color: chart.ink, fontSize: 14, fontWeight: '600' },
    rankNo: { color: chart.inkMuted, fontWeight: '600' },
    rankBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 16 },
    rankBar: {
      height: 12,
      backgroundColor: chart.bar,
      borderTopRightRadius: 4,
      borderBottomRightRadius: 4,
      minWidth: 2,
    },
    rankValue: { color: chart.ink, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    rankUnit: { color: chart.inkMuted, fontWeight: '400' },
    readout: { color: chart.inkSecondary, fontSize: 12, marginBottom: 6, minHeight: 16 },
    yTick: { position: 'absolute', right: 6, color: chart.inkMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
    grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: chart.grid },
    baseline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: chart.axis },
    xTick: {
      position: 'absolute',
      width: 24,
      textAlign: 'center',
      color: chart.inkMuted,
      fontSize: 10,
      fontVariant: ['tabular-nums'],
    },
  }),
);
