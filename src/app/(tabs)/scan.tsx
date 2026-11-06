import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { LocationPicker } from '../../components/LocationPicker';
import { Button, Card, Chip, Field, styles } from '../../components/ui';
import { formatQty, listLocations, listMyStock, listProducts, recordAdjustment } from '../../lib/api';
import { useAuth, useLocationAccess, useRole } from '../../lib/auth';
import { isConfident, matchProducts, type ProductMatch } from '../../lib/match';
import { cached, submitScan, useOnline, useQueue } from '../../lib/offline';
import { can } from '../../lib/roles';
import { colors, kindColor } from '../../lib/theme';
import { timeAgo } from '../../lib/time';
import type { Location, MovementKind, Product, StockRow } from '../../lib/types';

const MODES: { kind: MovementKind; label: string }[] = [
  { kind: 'IN', label: 'Stock In' },
  { kind: 'OUT', label: 'Stock Out' },
  { kind: 'TRANSFER', label: 'Transfer' },
  { kind: 'ADJUST', label: 'Adjust' },
];

export default function ScanScreen() {
  const role = useRole();
  const { profile } = useAuth();
  const canUse = useLocationAccess();
  const online = useOnline();
  const queue = useQueue();
  const modes = MODES.filter(
    (m) =>
      (m.kind !== 'ADJUST' || can.adjustStock(role)) &&
      (m.kind !== 'TRANSFER' || can.transfer(role, profile?.can_transfer)),
  );

  // Data (from the server, or the copy on this phone when offline)
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const [mode, setMode] = useState<MovementKind>('IN');
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);

  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  const [readText, setReadText] = useState<string | null>(null);
  const [matches, setMatches] = useState<ProductMatch[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Text that found nothing; looked up again when coming back from "Register product".
  const unknownCode = useRef<string | null>(null);

  const loadStock = useCallback(async () => {
    const s = await cached('stock', listMyStock);
    setStockRows(s.value);
    setSyncedAt(s.at);
    setFromCache(s.fromCache);
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const [locs, prods] = await Promise.all([
            cached('locations', listLocations),
            cached('products', listProducts),
          ]);
          const list = locs.value;
          setLocations(list);
          setProducts(prods.value);
          // Source must be one of my locations; a transfer may go to any location.
          const own = list.filter((l) => canUse(l.id));
          const wrh = own.find((l) => l.kind === 'warehouse') ?? own[0];
          const store =
            own.find((l) => l.kind === 'store' && l.id !== wrh?.id) ??
            list.find((l) => l.kind === 'store' && l.id !== wrh?.id) ??
            list.find((l) => l.id !== wrh?.id);
          setFromId((cur) => (own.some((l) => l.id === cur) ? cur : (wrh?.id ?? null)));
          setToId((cur) => (list.some((l) => l.id === cur) ? cur : (store?.id ?? wrh?.id ?? null)));
          await loadStock();
          if (unknownCode.current) findText([unknownCode.current], prods.value);
        } catch (e) {
          setMessage({ ok: false, text: (e as Error).message });
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Stock for the chosen product, including scans still waiting to sync on this phone.
  const pendingDelta = useCallback(
    (productId: string, locationId: string | null) =>
      queue
        .filter((q) => q.status === 'pending' && q.product_id === productId)
        .reduce(
          (n, q) =>
            n + (q.to_id === locationId && q.kind === 'IN' ? q.qty : 0) - (q.from_id === locationId ? q.qty : 0),
          0,
        ),
    [queue],
  );
  const stockAt = useCallback(
    (locationId: string | null) => {
      if (!product || !locationId) return 0;
      const row = stockRows.find((s) => s.product_id === product.id && s.location_id === locationId);
      return (row?.qty ?? 0) + pendingDelta(product.id, locationId);
    },
    [product, stockRows, pendingDelta],
  );

  function choose(p: Product) {
    setProduct(p);
    unknownCode.current = null;
    setQty(mode === 'ADJUST' ? formatQty(stockAtFor(p, fromId)) : '1');
  }
  const stockAtFor = (p: Product, locationId: string | null) =>
    (stockRows.find((s) => s.product_id === p.id && s.location_id === locationId)?.qty ?? 0) +
    pendingDelta(p.id, locationId);

  /** Exact barcode / code first; otherwise the closest product names. */
  function findText(blocks: string[], list: Product[] = products) {
    const text = blocks.join(' ').trim();
    if (!text) return;
    setMessage(null);
    setLookedUp(text);
    const exact = list.find((p) => p.barcode.trim().toLowerCase() === text.toLowerCase());
    const found = exact ? [{ product: exact, score: 1 }] : matchProducts(blocks, list, 6);
    setMatches(found);
    if (exact || isConfident(found)) {
      choose(found[0].product);
    } else {
      setProduct(null);
      unknownCode.current = found.length ? null : text;
    }
  }

  function reset() {
    unknownCode.current = null;
    setCode('');
    setLookedUp(null);
    setReadText(null);
    setMatches([]);
    setProduct(null);
    setQty('1');
    setNote('');
  }

  const mine = locations.filter((l) => canUse(l.id));
  // Which side(s) each mode uses. ADJUST uses the "from" picker as its location.
  const isAdjust = mode === 'ADJUST';
  const usesFrom = mode === 'OUT' || mode === 'TRANSFER' || isAdjust;
  const usesTo = mode === 'IN' || mode === 'TRANSFER';
  const fromLoc = locations.find((l) => l.id === fromId);
  const toLoc = locations.find((l) => l.id === toId);
  const qtyNum = Number(qty.replace(',', '.'));
  const available = stockAt(fromId);

  function chooseMode(k: MovementKind) {
    setMode(k);
    // Stock In must go into one of my own locations.
    if (k === 'IN' && !canUse(toId)) setToId(mine[0]?.id ?? null);
    setQty(k === 'ADJUST' ? formatQty(stockAt(fromId)) : '1');
  }

  function chooseFrom(id: string) {
    setFromId(id);
    if (isAdjust) setQty(formatQty(stockAt(id)));
  }

  let problem: string | null = null;
  if (!product) problem = 'Scan or pick a product first';
  else if (isAdjust) {
    if (!online) problem = 'A stock count needs internet (it must be checked against current stock)';
    else if (qty.trim() === '' || !(qtyNum >= 0)) problem = 'Enter the counted quantity (0 or more)';
    else if (!fromLoc) problem = 'Pick a location';
    else if (qtyNum === available) problem = `Stock at ${fromLoc.code} is already ${formatQty(available)}`;
  } else if (!(qtyNum > 0)) problem = 'Enter a quantity above 0';
  else if (usesFrom && !fromLoc) problem = 'Pick a source location';
  else if (usesTo && !toLoc) problem = 'Pick a destination location';
  else if (mode === 'TRANSFER' && fromId === toId) problem = 'Source and destination must differ';
  else if (usesFrom && qtyNum > available) problem = `Only ${formatQty(available)} at ${fromLoc?.code}`;

  const unit = product?.unit ?? '';
  const q = `${formatQty(qtyNum || 0)} ${unit}`.trim();
  const summary = isAdjust
    ? `Set ${fromLoc?.code ?? '?'}: ${formatQty(available)} → ${q}`
    : mode === 'IN'
      ? `In ${q} → ${toLoc?.code ?? '?'}`
      : mode === 'OUT'
        ? `Out ${q} ← ${fromLoc?.code ?? '?'}`
        : `Send ${q}  ${fromLoc?.code ?? '?'} → ${toLoc?.code ?? '?'}`;

  async function submit() {
    if (!product || problem) return;
    setBusy(true);
    try {
      if (mode === 'ADJUST') {
        await recordAdjustment({ productId: product.id, locationId: fromId!, newQty: qtyNum, note });
        setMessage({ ok: true, text: `Saved: ${product.name} — ${summary}` });
      } else {
        const { queued } = await submitScan({
          kind: mode,
          product_id: product.id,
          product_name: product.name,
          unit: product.unit,
          qty: qtyNum,
          from_id: usesFrom ? fromId : null,
          to_id: usesTo ? toId : null,
          from_code: usesFrom ? (fromLoc?.code ?? null) : null,
          to_code: usesTo ? (toLoc?.code ?? null) : null,
          note,
        });
        setMessage({
          ok: true,
          text: queued
            ? `Saved on this phone: ${product.name} — ${summary}. It will be sent when you are back online.`
            : mode === 'TRANSFER'
              ? `Sent: ${product.name} — ${summary}. Waiting for ${toLoc?.code} to receive it.`
              : `Saved: ${product.name} — ${summary}`,
        });
      }
      reset();
      loadStock().catch(() => {});
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const step = (d: number) => setQty(String(Math.max(0, (Number(qty) || 0) + d)));
  const pendingCount = queue.filter((q) => q.status === 'pending').length;
  const failedCount = queue.filter((q) => q.status === 'failed').length;
  const otherMatches = useMemo(() => matches.filter((m) => m.product.id !== product?.id), [matches, product]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        {(!online || fromCache) && (
          <Card style={{ borderColor: colors.warn, backgroundColor: colors.warnBg }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{online ? 'Showing saved data' : 'Offline'}</Text>
            <Text style={{ color: colors.text }}>
              In / Out / Transfer are saved on this phone and sent automatically when you are back online.
              {syncedAt ? ` Stock shown as of ${timeAgo(syncedAt)}.` : ''}
            </Text>
          </Card>
        )}
        {(pendingCount > 0 || failedCount > 0) && (
          <Pressable onPress={() => router.push('/queue')}>
            <Card style={{ borderColor: failedCount ? colors.out : colors.primary }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {pendingCount ? `${pendingCount} waiting to sync` : ''}
                {pendingCount && failedCount ? ' · ' : ''}
                {failedCount ? `${failedCount} need attention` : ''}
              </Text>
              <Text style={styles.muted}>Tap to see them</Text>
            </Card>
          </Pressable>
        )}

        <View style={styles.chipRow}>
          {modes.map((m) => (
            <Chip
              key={m.kind}
              label={m.label}
              active={mode === m.kind}
              color={kindColor[m.kind]}
              onPress={() => chooseMode(m.kind)}
            />
          ))}
        </View>

        {usesFrom && (
          <LocationPicker
            label={isAdjust ? 'Location to count' : mode === 'TRANSFER' ? 'From' : 'Take out of'}
            locations={mine}
            value={fromId}
            onChange={chooseFrom}
          />
        )}
        {usesTo && (
          <LocationPicker
            label={mode === 'TRANSFER' ? 'To' : 'Put into'}
            locations={mode === 'TRANSFER' ? locations : mine}
            value={toId}
            onChange={setToId}
            exclude={mode === 'TRANSFER' ? fromId : null}
          />
        )}

        <Button title="Scan with camera (barcode or words)" onPress={() => setCamera(true)} color={kindColor[mode]} />
        <TextInput
          style={styles.input}
          placeholder="…or type a name / code (or use a USB scanner), then Enter"
          placeholderTextColor={colors.muted}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={() => findText([code])}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />

        {message && (
          <Card style={{ borderColor: message.ok ? colors.in : colors.out }}>
            <Text style={{ color: message.ok ? colors.in : colors.out, fontWeight: '600' }}>{message.text}</Text>
          </Card>
        )}

        {readText && (
          <Text style={styles.muted} numberOfLines={3}>
            Read from label: “{readText}”
          </Text>
        )}

        {/* No clear match: let the user pick the closest product */}
        {lookedUp && !product && matches.length > 0 && (
          <Card style={{ gap: 8 }}>
            <Text style={styles.title}>Which product is it?</Text>
            <Text style={styles.muted}>Closest matches for “{lookedUp}”</Text>
            {matches.map((m) => (
              <MatchRow key={m.product.id} m={m} onPress={() => choose(m.product)} />
            ))}
          </Card>
        )}

        {lookedUp && !product && matches.length === 0 && !busy && (
          <Card>
            <Text style={styles.title}>No matching product</Text>
            <Text style={styles.muted}>{lookedUp}</Text>
            {can.manageProducts(role) ? (
              online ? (
                <Button
                  title="Register a new product"
                  onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new', barcode: lookedUp } })}
                />
              ) : (
                <Text style={{ color: colors.text }}>Adding products needs internet.</Text>
              )
            ) : (
              <Text style={{ color: colors.text }}>Ask your Team Leader or an Oversee to register this product.</Text>
            )}
          </Card>
        )}

        {product && (
          <Card>
            <Text style={styles.title}>{product.name}</Text>
            <Text style={styles.muted}>{product.barcode}</Text>
            <View style={[styles.chipRow, { marginTop: 4 }]}>
              {mine.map((l) => (
                <Text key={l.id} style={{ color: colors.text }}>
                  {l.code}: <Text style={{ fontWeight: '700' }}>{formatQty(stockAt(l.id))}</Text>
                </Text>
              ))}
            </View>
            {otherMatches.length > 0 && (
              <View style={{ gap: 6, marginTop: 6 }}>
                <Text style={styles.muted}>Not this one?</Text>
                <View style={styles.chipRow}>
                  {otherMatches.slice(0, 4).map((m) => (
                    <Chip
                      key={m.product.id}
                      label={`${m.product.name} · ${Math.round(m.score * 100)}%`}
                      active={false}
                      color={colors.muted}
                      onPress={() => choose(m.product)}
                    />
                  ))}
                </View>
              </View>
            )}

            <Text style={[styles.label, { marginTop: 8 }]}>
              {isAdjust ? `Counted quantity at ${fromLoc?.code ?? '?'}` : 'Quantity'} ({product.unit})
            </Text>
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
            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder={isAdjust ? 'e.g. stock count, damaged' : 'e.g. supplier, invoice no.'}
            />

            {problem && <Text style={{ color: colors.out }}>{problem}</Text>}
            <Button title={`${summary}`} color={kindColor[mode]} onPress={submit} loading={busy} disabled={!!problem} />
            <Button title="Cancel" variant="outline" color={colors.muted} onPress={reset} />
          </Card>
        )}
      </ScrollView>

      <BarcodeScanner
        visible={camera}
        onClose={() => setCamera(false)}
        onScanned={(c) => {
          setCamera(false);
          setReadText(null);
          setCode(c);
          findText([c]);
        }}
        onText={(blocks) => {
          setCamera(false);
          setReadText(blocks.join(' / '));
          setCode('');
          findText(blocks);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function MatchRow({ m, onPress }: { m: ProductMatch; onPress: () => void }) {
  const pct = Math.round(m.score * 100);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { flexDirection: 'row', alignItems: 'center' },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{m.product.name}</Text>
        <Text style={styles.muted}>{m.product.barcode}</Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{pct}%</Text>
    </Pressable>
  );
}
