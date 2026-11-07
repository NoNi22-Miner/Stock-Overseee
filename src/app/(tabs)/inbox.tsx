import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, Empty, styles } from '../../components/ui';
import { listNotifications, markNotificationsRead } from '../../lib/api';
import { colors, themed } from '../../lib/theme';
import { timeAgo } from '../../lib/time';
import type { AppNotification, NotificationKind } from '../../lib/types';
import { useUnread } from '../../lib/unread';

const KIND_LABEL: Record<NotificationKind, string> = {
  transfer_incoming: 'Incoming transfer',
  transfer_received: 'Fully received',
  transfer_short: 'Received short',
  transfer_resolved: 'Missing items',
  stock_change: 'Stock change',
  low_stock: 'Low stock',
};
const KIND_COLOR = themed<Record<NotificationKind, string>>(() => ({
  transfer_incoming: colors.primary,
  transfer_received: colors.in,
  transfer_short: colors.warn,
  transfer_resolved: colors.muted,
  stock_change: colors.border,
  low_stock: colors.out,
}));

export default function InboxScreen() {
  const { refresh } = useUnread();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listNotifications());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function open(n: AppNotification) {
    if (!n.read_at) {
      setRows((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      markNotificationsRead([n.id]).then(refresh, () => {});
    }
    if (n.data.transfer_id) router.push(`/transfer/${n.data.transfer_id}`);
    else if (n.data.product_id) router.push(`/product/${n.data.product_id}`);
  }

  async function readAll() {
    await markNotificationsRead().catch(() => {});
    await load();
    refresh();
  }

  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <View style={styles.screen}>
      <View style={[styles.pad, { paddingBottom: 4 }]}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.title}>{unread ? `${unread} unread` : 'All caught up'}</Text>
          {unread > 0 && <Button title="Mark all read" variant="outline" onPress={readAll} />}
        </View>
        {error && <Text style={{ color: colors.out }}>{error}</Text>}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="No notifications yet." />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={({ pressed }) => [
              styles.card,
              { borderLeftWidth: 5, borderLeftColor: KIND_COLOR[item.kind] },
              !item.read_at && { backgroundColor: colors.primarySoft },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={styles.row}>
              {!item.read_at && (
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
              )}
              <Text style={[styles.label, { flex: 1 }]}>{KIND_LABEL[item.kind]}</Text>
              <Text style={styles.muted}>{timeAgo(item.created_at)}</Text>
            </View>
            <Text style={[styles.title, !item.read_at && { fontWeight: '800' }]}>{item.title}</Text>
            <Text style={{ color: colors.text }}>{item.body}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
