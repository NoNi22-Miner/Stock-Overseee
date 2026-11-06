import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { TransferCard } from '../../components/TransferCard';
import { Chip, Empty, styles } from '../../components/ui';
import { listTransfers } from '../../lib/api';
import { useLocationAccess } from '../../lib/auth';
import { colors } from '../../lib/theme';
import type { Transfer } from '../../lib/types';

type Tab = 'open' | 'done';

/** Transfers between locations: what is coming in, what is on its way out, and what is short. */
export default function TransfersScreen() {
  const canUse = useLocationAccess();
  const [tab, setTab] = useState<Tab>('open');
  const [rows, setRows] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listTransfers({ status: tab === 'open' ? ['in_transit', 'short'] : ['done'], limit: 100 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const incoming = rows.filter((t) => t.status === 'in_transit' && canUse(t.to_location_id));
  const outgoing = rows.filter((t) => t.status === 'in_transit' && !canUse(t.to_location_id));
  const short = rows.filter((t) => t.status === 'short');

  const section = (title: string, hint: string, list: Transfer[]) =>
    list.length > 0 && (
      <View style={{ gap: 8 }}>
        <View>
          <Text style={styles.title}>
            {title} <Text style={styles.muted}>({list.length})</Text>
          </Text>
          <Text style={styles.muted}>{hint}</Text>
        </View>
        {list.map((t) => (
          <TransferCard key={t.id} t={t} />
        ))}
      </View>
    );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <View style={styles.chipRow}>
        <Chip label="Open" active={tab === 'open'} onPress={() => setTab('open')} />
        <Chip label="Done" active={tab === 'done'} onPress={() => setTab('done')} />
      </View>
      {error && <Text style={{ color: colors.out }}>{error}</Text>}

      {tab === 'open' ? (
        <>
          {section('To receive', 'Coming to your location. Tap to confirm what arrived.', incoming)}
          {section('Short', 'Received with items missing. Tap to resolve the missing items.', short)}
          {section('On the way', 'Sent from your location, not received yet.', outgoing)}
          {!loading && !incoming.length && !short.length && !outgoing.length && (
            <Empty text="No open transfers. Send one from Scan → Transfer." />
          )}
        </>
      ) : rows.length ? (
        rows.map((t) => <TransferCard key={t.id} t={t} />)
      ) : (
        !loading && <Empty text="No finished transfers yet." />
      )}
    </ScrollView>
  );
}
