import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, TextInput, View } from 'react-native';
import { STATUS_LABEL, transferSummary } from '../../components/TransferCard';
import { Button, Card, Chip, Field, styles, Text } from '../../components/ui';
import { formatQty, getTransfer, receiveTransfer, resolveTransfer, type ResolveOutcome } from '../../lib/api';
import { useAuth, useLocationAccess, useRole } from '../../lib/auth';
import { can } from '../../lib/roles';
import { colors, fs } from '../../lib/theme';
import type { Transfer } from '../../lib/types';

/** One transfer: receive it (all or fewer), or resolve the missing items of a short one. */
export default function TransferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useRole();
  const { session } = useAuth();
  const canUse = useLocationAccess();

  const [t, setT] = useState<Transfer | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<ResolveOutcome>('returned');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const row = await getTransfer(id);
      setT(row);
      setQty(formatQty(row.status === 'in_transit' ? row.qty_sent : row.qty_open));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!t) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', padding: 16 }]}>
        {error ? <Text style={{ color: colors.out }}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const qtyNum = Number(qty.replace(',', '.'));
  const canReceive = t.status === 'in_transit' && can.moveStock(role) && canUse(t.to_location_id);
  const canResolve =
    t.status === 'short' &&
    ((t.sent_by === session?.user.id && can.moveStock(role)) ||
      (can.adjustStock(role) && (canUse(t.from_location_id) || canUse(t.to_location_id))));

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await fn();
      setNote('');
      await load();
      Alert.alert('Saved', done);
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const receive = (amount: number) =>
    run(
      () => receiveTransfer(t.id, amount, note),
      amount === t.qty_sent
        ? `All ${formatQty(amount)} ${t.unit} received at ${t.to_code}.`
        : `${formatQty(amount)} of ${formatQty(t.qty_sent)} ${t.unit} received. ${t.from_code} has been told ${formatQty(t.qty_sent - amount)} are missing.`,
    );

  const OUTCOMES: { key: ResolveOutcome; label: string }[] = [
    { key: 'returned', label: `Returned to ${t.from_code}` },
    { key: 'late', label: `Arrived late at ${t.to_code}` },
    { key: 'lost', label: 'Lost' },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `${t.from_code} → ${t.to_code}` }} />

      <Card>
        <Text style={styles.label}>{STATUS_LABEL[t.status]}</Text>
        <Text style={[styles.title, { fontSize: fs(20) }]}>{t.product_name}</Text>
        <Text style={styles.muted}>{t.barcode}</Text>
        <Text style={{ color: colors.text, fontSize: fs(16), marginTop: 4 }}>{transferSummary(t)}</Text>
      </Card>

      <Card style={{ gap: 4 }}>
        <Text style={styles.label}>Timeline</Text>
        <Text style={{ color: colors.text }}>
          Sent {formatQty(t.qty_sent)} {t.unit} from {t.from_code} · {new Date(t.sent_at).toLocaleString()}
          {t.sent_by_name ? ` · ${t.sent_by_name}` : ''}
        </Text>
        {t.note && <Text style={styles.muted}>“{t.note}”</Text>}
        {t.received_at && (
          <Text style={{ color: colors.text }}>
            Received {formatQty(t.qty_received ?? 0)} at {t.to_code} · {new Date(t.received_at).toLocaleString()}
            {t.received_by_name ? ` · ${t.received_by_name}` : ''}
          </Text>
        )}
        {t.receive_note && <Text style={styles.muted}>“{t.receive_note}”</Text>}
        {t.resolved_at && (
          <Text style={{ color: colors.text }}>
            Missing items updated · {new Date(t.resolved_at).toLocaleString()}
            {t.resolved_by_name ? ` · ${t.resolved_by_name}` : ''}
          </Text>
        )}
      </Card>

      {canReceive && (
        <Card style={{ gap: 10 }}>
          <Text style={styles.title}>Receive at {t.to_code}</Text>
          <Button
            title={`All ${formatQty(t.qty_sent)} ${t.unit} arrived`}
            color={colors.in}
            onPress={() => receive(t.qty_sent)}
            loading={busy}
          />
          <Text style={styles.muted}>Fewer arrived? Enter how many:</Text>
          <TextInput
            style={[styles.input, { fontSize: fs(20), fontWeight: '700', textAlign: 'center' }]}
            keyboardType="decimal-pad"
            value={qty}
            onChangeText={setQty}
            selectTextOnFocus
          />
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. 2 bent, left at WRH" />
          <Button
            title={`Received ${formatQty(qtyNum || 0)} of ${formatQty(t.qty_sent)}`}
            variant="outline"
            color={colors.warn}
            onPress={() => receive(qtyNum)}
            disabled={busy || !(qtyNum >= 0) || qtyNum > t.qty_sent || qty.trim() === ''}
          />
        </Card>
      )}

      {canResolve && (
        <Card style={{ gap: 10 }}>
          <Text style={styles.title}>
            Resolve {formatQty(t.qty_open)} missing {t.unit}
          </Text>
          <View style={styles.chipRow}>
            {OUTCOMES.map((o) => (
              <Chip key={o.key} label={o.label} active={outcome === o.key} onPress={() => setOutcome(o.key)} />
            ))}
          </View>
          <TextInput
            style={[styles.input, { fontSize: fs(20), fontWeight: '700', textAlign: 'center' }]}
            keyboardType="decimal-pad"
            value={qty}
            onChangeText={setQty}
            selectTextOnFocus
          />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
          <Button
            title="Save"
            onPress={() =>
              run(
                () => resolveTransfer(t.id, outcome, qtyNum, note),
                `${formatQty(qtyNum)} ${t.unit} ${OUTCOMES.find((o) => o.key === outcome)?.label.toLowerCase()}.`,
              )
            }
            loading={busy}
            disabled={!(qtyNum > 0) || qtyNum > t.qty_open}
          />
        </Card>
      )}

      {t.status === 'in_transit' && !canReceive && (
        <Text style={styles.muted}>Waiting for someone at {t.to_code} to receive it.</Text>
      )}
      {t.status === 'short' && !canResolve && (
        <Text style={styles.muted}>The sender or an Oversee / Team Leader will resolve the missing items.</Text>
      )}
    </ScrollView>
  );
}
