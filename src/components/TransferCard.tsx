import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { formatQty } from '../lib/api';
import { colors, themed } from '../lib/theme';
import type { Transfer } from '../lib/types';
import { styles } from './ui';

export const STATUS_LABEL = { in_transit: 'In transit', short: 'Short', done: 'Done' } as const;
const STATUS_COLOR = themed(() => ({ in_transit: colors.primary, short: colors.warn, done: colors.in }));

export function transferSummary(t: Transfer) {
  if (t.status === 'in_transit') return `${formatQty(t.qty_sent)} ${t.unit} on the way`;
  const received = `${formatQty(t.qty_received ?? 0)} of ${formatQty(t.qty_sent)} ${t.unit} received`;
  if (t.status === 'short') return `${received} · ${formatQty(t.qty_open)} missing`;
  const extra = [
    t.qty_returned ? `${formatQty(t.qty_returned)} returned` : '',
    t.qty_late ? `${formatQty(t.qty_late)} arrived late` : '',
    t.qty_lost ? `${formatQty(t.qty_lost)} lost` : '',
  ].filter(Boolean);
  return extra.length ? `${received} · ${extra.join(' · ')}` : received;
}

export function TransferCard({ t }: { t: Transfer }) {
  const color = STATUS_COLOR[t.status];
  return (
    <Pressable
      onPress={() => router.push(`/transfer/${t.id}`)}
      style={({ pressed }) => [
        styles.card,
        { borderLeftWidth: 5, borderLeftColor: color },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.row}>
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
          {t.product_name}
        </Text>
        <View
          style={{ borderRadius: 999, borderWidth: 1.5, borderColor: color, paddingHorizontal: 10, paddingVertical: 2 }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{STATUS_LABEL[t.status]}</Text>
        </View>
      </View>
      <Text style={{ color: colors.text, fontWeight: '600' }}>
        {t.from_code} → {t.to_code}
      </Text>
      <Text style={styles.muted}>{transferSummary(t)}</Text>
      <Text style={styles.muted}>
        Sent {new Date(t.sent_at).toLocaleString()}
        {t.sent_by_name ? ` by ${t.sent_by_name}` : ''}
      </Text>
    </Pressable>
  );
}
