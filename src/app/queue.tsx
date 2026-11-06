import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Card, Empty, styles } from '../components/ui';
import { formatQty } from '../lib/api';
import { discardScan, retryScan, syncQueue, useOnline, useQueue, type QueuedScan } from '../lib/offline';
import { colors, kindColor } from '../lib/theme';

/** Scans saved on this phone while offline: waiting to be sent, or refused by the server. */
export default function QueueScreen() {
  const queue = useQueue();
  const online = useOnline();
  const [busy, setBusy] = useState(false);

  async function syncNow() {
    setBusy(true);
    const { synced, failed } = await syncQueue();
    setBusy(false);
    if (!online) Alert.alert('Offline', 'They will be sent when the connection is back.');
    else if (synced || failed) Alert.alert('Sync', `${synced} sent${failed ? `, ${failed} need attention` : ''}.`);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad}>
      <Text style={styles.muted}>
        {online
          ? 'Online. Waiting scans are sent automatically.'
          : 'Offline. Scans are kept on this phone until the connection is back.'}
      </Text>
      {queue.some((q) => q.status === 'pending') && (
        <Button title="Send now" onPress={syncNow} loading={busy} disabled={!online} />
      )}
      {queue.length === 0 && <Empty text="Nothing waiting. All scans are synced." />}
      {queue.map((q) => (
        <QueueItem key={q.client_id} q={q} />
      ))}
    </ScrollView>
  );
}

function describe(q: QueuedScan) {
  if (q.kind === 'IN') return `IN → ${q.to_code}`;
  if (q.kind === 'OUT') return `OUT ← ${q.from_code}`;
  return `SEND ${q.from_code} → ${q.to_code}`;
}

function QueueItem({ q }: { q: QueuedScan }) {
  const [qty, setQty] = useState(formatQty(q.qty));
  const failed = q.status === 'failed';
  const qtyNum = Number(qty.replace(',', '.'));

  return (
    <Card style={{ borderLeftWidth: 5, borderLeftColor: failed ? colors.out : kindColor[q.kind], gap: 6 }}>
      <View style={styles.row}>
        <Text style={{ color: kindColor[q.kind], fontWeight: '800', flex: 1 }}>{describe(q)}</Text>
        <Text style={{ color: colors.text, fontWeight: '700' }}>
          {formatQty(q.qty)} {q.unit}
        </Text>
      </View>
      <Text style={styles.title}>{q.product_name}</Text>
      <Text style={styles.muted}>
        Scanned {new Date(q.scanned_at).toLocaleString()}
        {q.note ? `  ·  ${q.note}` : ''}
      </Text>
      {failed ? (
        <>
          <Text style={{ color: colors.out, fontWeight: '600' }}>Not synced: {q.error}</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1, textAlign: 'center' }]}
              keyboardType="decimal-pad"
              value={qty}
              onChangeText={setQty}
              selectTextOnFocus
            />
            <Button title="Try again" onPress={() => retryScan(q.client_id, qtyNum)} disabled={!(qtyNum > 0)} />
          </View>
          <Button
            title="Discard"
            variant="outline"
            color={colors.out}
            onPress={() =>
              Alert.alert('Discard this scan?', 'It will not be recorded.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => discardScan(q.client_id) },
              ])
            }
          />
        </>
      ) : (
        <Text style={styles.muted}>Waiting to sync</Text>
      )}
    </Card>
  );
}
