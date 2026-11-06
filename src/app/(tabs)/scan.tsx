import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { LocationPicker } from '../../components/LocationPicker';
import { Button, Card, Chip, Field, styles } from '../../components/ui';
import { findProductByBarcode, formatQty, listLocations, recordMovement, stockForProduct } from '../../lib/api';
import { colors, kindColor } from '../../lib/theme';
import type { Location, MovementKind, Product, StockRow } from '../../lib/types';

const MODES: { kind: MovementKind; label: string }[] = [
  { kind: 'IN', label: 'Stock In' },
  { kind: 'OUT', label: 'Stock Out' },
  { kind: 'TRANSFER', label: 'Transfer' },
];

export default function ScanScreen() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [mode, setMode] = useState<MovementKind>('IN');
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);

  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Barcode that was not found; re-checked when the screen regains focus.
  const unknownCode = useRef<string | null>(null);

  // Load locations and pick sensible defaults: warehouse -> store.
  useFocusEffect(
    useCallback(() => {
      listLocations()
        .then((locs) => {
          setLocations(locs);
          const wrh = locs.find((l) => l.kind === 'warehouse') ?? locs[0];
          const store = locs.find((l) => l.kind === 'store' && l.id !== wrh?.id) ?? locs.find((l) => l.id !== wrh?.id);
          setFromId((cur) => (locs.some((l) => l.id === cur) ? cur : wrh?.id ?? null));
          setToId((cur) => (locs.some((l) => l.id === cur) ? cur : store?.id ?? wrh?.id ?? null));
        })
        .catch((e) => setMessage({ ok: false, text: e.message }));
      // Coming back from "Register product": look the barcode up again.
      if (unknownCode.current) lookup(unknownCode.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  async function lookup(raw: string) {
    const barcode = raw.trim();
    if (!barcode) return;
    setCode(barcode);
    setMessage(null);
    setBusy(true);
    try {
      const p = await findProductByBarcode(barcode);
      setLookedUp(barcode);
      setProduct(p);
      unknownCode.current = p ? null : barcode;
      setStock(p ? await stockForProduct(p.id) : []);
      setQty('1');
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    unknownCode.current = null;
    setCode('');
    setLookedUp(null);
    setProduct(null);
    setStock([]);
    setQty('1');
    setNote('');
  }

  // Which side(s) each mode uses.
  const usesFrom = mode === 'OUT' || mode === 'TRANSFER';
  const usesTo = mode === 'IN' || mode === 'TRANSFER';
  const fromLoc = locations.find((l) => l.id === fromId);
  const toLoc = locations.find((l) => l.id === toId);
  const qtyNum = Number(qty.replace(',', '.'));
  const available = stock.find((s) => s.location_id === fromId)?.qty ?? 0;

  let problem: string | null = null;
  if (!product) problem = 'Scan a product first';
  else if (!(qtyNum > 0)) problem = 'Enter a quantity above 0';
  else if (usesFrom && !fromLoc) problem = 'Pick a source location';
  else if (usesTo && !toLoc) problem = 'Pick a destination location';
  else if (mode === 'TRANSFER' && fromId === toId) problem = 'Source and destination must differ';
  else if (usesFrom && qtyNum > available) problem = `Only ${formatQty(available)} at ${fromLoc?.code}`;

  const summary =
    mode === 'IN'
      ? `In ${formatQty(qtyNum || 0)} → ${toLoc?.code ?? '?'}`
      : mode === 'OUT'
        ? `Out ${formatQty(qtyNum || 0)} ← ${fromLoc?.code ?? '?'}`
        : `Move ${formatQty(qtyNum || 0)}  ${fromLoc?.code ?? '?'} → ${toLoc?.code ?? '?'}`;

  async function submit() {
    if (!product || problem) return;
    setBusy(true);
    try {
      await recordMovement({
        kind: mode,
        productId: product.id,
        qty: qtyNum,
        fromId: usesFrom ? fromId : null,
        toId: usesTo ? toId : null,
        note,
      });
      setMessage({ ok: true, text: `Saved: ${product.name} — ${summary} ${product.unit}` });
      reset();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const step = (d: number) => setQty(String(Math.max(0, (Number(qty) || 0) + d)));

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <View style={styles.chipRow}>
          {MODES.map((m) => (
            <Chip
              key={m.kind}
              label={m.label}
              active={mode === m.kind}
              color={kindColor[m.kind]}
              onPress={() => setMode(m.kind)}
            />
          ))}
        </View>

        {usesFrom && (
          <LocationPicker
            label={mode === 'TRANSFER' ? 'From' : 'Take out of'}
            locations={locations}
            value={fromId}
            onChange={setFromId}
          />
        )}
        {usesTo && (
          <LocationPicker
            label={mode === 'TRANSFER' ? 'To' : 'Put into'}
            locations={locations}
            value={toId}
            onChange={setToId}
            exclude={mode === 'TRANSFER' ? fromId : null}
          />
        )}

        <Button title="Scan with camera" onPress={() => setCamera(true)} color={kindColor[mode]} />
        <TextInput
          style={styles.input}
          placeholder="…or type / use a USB scanner, then Enter"
          placeholderTextColor={colors.muted}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={() => lookup(code)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />

        {message && (
          <Card style={{ borderColor: message.ok ? colors.in : colors.out }}>
            <Text style={{ color: message.ok ? colors.in : colors.out, fontWeight: '600' }}>{message.text}</Text>
          </Card>
        )}

        {lookedUp && !product && !busy && (
          <Card>
            <Text style={styles.title}>Unknown barcode</Text>
            <Text style={styles.muted}>{lookedUp}</Text>
            <Button
              title="Register this product"
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new', barcode: lookedUp } })}
            />
          </Card>
        )}

        {product && (
          <Card>
            <Text style={styles.title}>{product.name}</Text>
            <Text style={styles.muted}>{product.barcode}</Text>
            <View style={[styles.chipRow, { marginTop: 4 }]}>
              {locations.map((l) => {
                const r = stock.find((s) => s.location_id === l.id);
                return (
                  <Text key={l.id} style={{ color: r?.is_low ? colors.warn : colors.text }}>
                    {l.code}: <Text style={{ fontWeight: '700' }}>{formatQty(r?.qty ?? 0)}</Text>
                    {r?.is_low ? ' (low)' : ''}
                  </Text>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: 8 }]}>Quantity ({product.unit})</Text>
            <View style={styles.row}>
              <Button title="−" variant="outline" onPress={() => step(-1)} style={{ width: 56 }} />
              <TextInput
                style={[styles.input, { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '700' }]}
                keyboardType="decimal-pad"
                value={qty}
                onChangeText={setQty}
                selectTextOnFocus
              />
              <Button title="+" variant="outline" onPress={() => step(1)} style={{ width: 56 }} />
            </View>
            <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. supplier, invoice no." />

            {problem && <Text style={{ color: colors.out }}>{problem}</Text>}
            <Button
              title={`${summary} ${product.unit}`}
              color={kindColor[mode]}
              onPress={submit}
              loading={busy}
              disabled={!!problem}
            />
            <Button title="Cancel" variant="outline" color={colors.muted} onPress={reset} />
          </Card>
        )}
      </ScrollView>

      <BarcodeScanner
        visible={camera}
        onClose={() => setCamera(false)}
        onScanned={(c) => {
          setCamera(false);
          lookup(c);
        }}
      />
    </KeyboardAvoidingView>
  );
}
