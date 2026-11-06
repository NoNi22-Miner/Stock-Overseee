import { Text, View } from 'react-native';
import { formatQty } from '../lib/api';
import { colors, kindColor } from '../lib/theme';
import type { MovementRow } from '../lib/types';
import { styles } from './ui';

export function describeMove(m: MovementRow) {
  if (m.kind === 'IN') return `IN → ${m.to_code}`;
  if (m.kind === 'OUT') return `OUT ← ${m.from_code}`;
  return `${m.from_code} → ${m.to_code}`;
}

export function HistoryItem({ item, showProduct = true }: { item: MovementRow; showProduct?: boolean }) {
  const color = kindColor[item.kind];
  return (
    <View style={[styles.card, { borderLeftWidth: 5, borderLeftColor: color }]}>
      <View style={styles.row}>
        <Text style={{ color, fontWeight: '800', flex: 1 }}>{describeMove(item)}</Text>
        <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>
          {item.kind === 'OUT' ? '−' : item.kind === 'IN' ? '+' : ''}
          {formatQty(item.qty)} {item.unit}
        </Text>
      </View>
      {showProduct && <Text style={styles.title}>{item.product_name}</Text>}
      <Text style={styles.muted}>
        {new Date(item.created_at).toLocaleString()}
        {item.note ? `  ·  ${item.note}` : ''}
      </Text>
    </View>
  );
}
