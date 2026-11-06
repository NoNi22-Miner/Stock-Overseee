import { Pressable, Text, View } from 'react-native';
import { formatQty } from '../lib/api';
import type { QueuedScan } from '../lib/offline';
import { colors, kindColor } from '../lib/theme';
import { timeAgo } from '../lib/time';
import type { MovementRow } from '../lib/types';
import { describeMove } from './HistoryList';
import { Chip, styles } from './ui';

export type RecentFilter = 'all' | 'mine';

/** Moves that can be done again as they were (not counts or transfer receipts). */
export const isRepeatable = (m: MovementRow) =>
  m.detail == null && (m.kind === 'IN' || m.kind === 'OUT' || m.kind === 'TRANSFER');

function queuedLabel(q: QueuedScan) {
  if (q.kind === 'IN') return `IN → ${q.to_code}`;
  if (q.kind === 'OUT') return `OUT ← ${q.from_code}`;
  return `SENT ${q.from_code} → ${q.to_code}`;
}

/**
 * Recent moves next to the scan form. Tap a move to fill the form with it;
 * ↻ repeats it as it was.
 */
export function RecentMoves({
  rows,
  queued,
  filter,
  onFilter,
  onUse,
  onRepeat,
  onRefresh,
  loading,
  offline,
}: {
  rows: MovementRow[];
  queued: QueuedScan[];
  filter: RecentFilter;
  onFilter: (f: RecentFilter) => void;
  onUse: (m: MovementRow) => void;
  onRepeat: (m: MovementRow) => void;
  onRefresh: () => void;
  loading: boolean;
  offline: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
        <View>
          <Text style={styles.title}>Recent moves</Text>
          <Text style={styles.muted}>Tap one to fill the form · ↻ to repeat it</Text>
        </View>
        <View style={styles.chipRow}>
          <Chip label="Everyone" active={filter === 'all'} onPress={() => onFilter('all')} />
          <Chip label="Mine" active={filter === 'mine'} onPress={() => onFilter('mine')} />
          <Chip label={loading ? '…' : '⟳'} active={false} onPress={onRefresh} />
        </View>
      </View>
      {offline && <Text style={styles.muted}>Offline: showing the moves saved on this phone.</Text>}

      {queued.map((q) => (
        <View key={q.client_id} style={[styles.card, rowStyle, { borderLeftColor: colors.muted, opacity: 0.8 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: kindColor[q.kind], fontWeight: '800', fontSize: 12 }}>{queuedLabel(q)}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {q.product_name}
            </Text>
            <Text style={styles.muted}>
              {q.status === 'failed' ? `Not synced: ${q.error}` : 'Waiting to sync'} · {timeAgo(q.scanned_at)}
            </Text>
          </View>
          <Text style={qtyStyle}>
            {formatQty(q.qty)} <Text style={styles.muted}>{q.unit}</Text>
          </Text>
        </View>
      ))}

      {rows.length === 0 && queued.length === 0 && (
        <Text style={[styles.muted, { paddingVertical: 12 }]}>
          {filter === 'mine' ? 'You have no moves yet.' : 'No moves yet.'}
        </Text>
      )}

      {rows.map((m) => {
        const repeatable = isRepeatable(m);
        return (
          <Pressable
            key={m.id}
            onPress={() => onUse(m)}
            accessibilityRole="button"
            accessibilityLabel={`Use: ${describeMove(m)} ${formatQty(m.qty)} ${m.unit} ${m.product_name}`}
            style={({ pressed }) => [
              styles.card,
              rowStyle,
              { borderLeftColor: kindColor[m.kind] },
              pressed && { opacity: 0.6 },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: kindColor[m.kind], fontWeight: '800', fontSize: 12 }}>{describeMove(m)}</Text>
              <Text style={styles.title} numberOfLines={1}>
                {m.product_name}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {timeAgo(m.scanned_at ?? m.created_at)}
                {m.actor_name ? ` · ${m.actor_name}` : ''}
                {m.note ? ` · ${m.note}` : ''}
              </Text>
            </View>
            <Text style={qtyStyle}>
              {m.kind === 'ADJUST' && m.qty_after != null ? `= ${formatQty(m.qty_after)}` : formatQty(m.qty)}{' '}
              <Text style={styles.muted}>{m.unit}</Text>
            </Text>
            {repeatable && (
              <Pressable
                onPress={() => onRepeat(m)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Repeat: ${describeMove(m)} ${formatQty(m.qty)} ${m.unit} ${m.product_name}`}
                style={({ pressed }) => [repeatBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>↻</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, borderLeftWidth: 5 };
const qtyStyle = { color: colors.text, fontWeight: '800' as const, fontSize: 16 };
const repeatBtn = {
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: 1.5,
  borderColor: colors.primary,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
