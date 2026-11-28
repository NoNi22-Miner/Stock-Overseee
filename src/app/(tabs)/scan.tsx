import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { ItemPicker } from '../../components/ItemPicker';
import { LocationPicker } from '../../components/LocationPicker';
import { RecentMoves, isRepeatable, type RecentFilter } from '../../components/RecentMoves';
import { describeMove } from '../../components/HistoryList';
import { Button, Card, Chip, Field, styles, Text } from '../../components/ui';
import { formatQty, listHistory, listLocations, listMyStock, listProducts, recordAdjustment } from '../../lib/api';
import { useAuth, useMoveAccess, useRole } from '../../lib/auth';
import {
  defaultGradeTerm,
  familyKey,
  gradeList,
  gradeName,
  gradeShort,
  gradeVersions,
  mappedGradeId,
  versionName,
} from '../../lib/grades';
import { cached, submitScan, useOnline, useQueue, type QueuedScan } from '../../lib/offline';
import { useRecognition } from '../../lib/recognition';
import { allowsDecimals, isSure, rankItems, splitName, type ItemMatch } from '../../lib/recognize';
import { identifyScanItems, type ScanHit } from '../../lib/scanItems';
import { can } from '../../lib/roles';
import { colors, fs, kindColor } from '../../lib/theme';
import { timeAgo } from '../../lib/time';
import type { Location, MovementKind, MovementRow, Product, StockRow } from '../../lib/types';

const MODES: { kind: MovementKind; label: string }[] = [
  { kind: 'IN', label: 'Stock In' },
  { kind: 'OUT', label: 'Stock Out' },
  { kind: 'TRANSFER', label: 'Transfer' },
  { kind: 'ADJUST', label: 'Adjust' },
];

export default function ScanScreen() {
  const role = useRole();
  const { profile, session, plan } = useAuth();
  const canUse = useMoveAccess(); // locations locked by the plan take no moves
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
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  /** Up to five items read from one scan, in order, each with its own grade. */
  const [scanHits, setScanHits] = useState<ScanHit[]>([]);
  /** The match list came from text, and the user had to pick: remember the pick for that text. */
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const recognition = useRecognition();
  const [product, setProduct] = useState<Product | null>(null);
  /** The grade to move: the item's own grade, or another (its version with that grade is used / made). */
  const [gradeId, setGradeId] = useState<string | null>(null);
  /** The grade written on the label that was read, if any. */
  const [readGrade, setReadGrade] = useState<string | null>(null);
  /** Grade a recognition entry assigned for the text just read. Null when the text named none. */
  const [nameGrade, setNameGrade] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<MovementRow[]>([]);
  const [recentFromCache, setRecentFromCache] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all');
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Text that found nothing; looked up again when coming back from "Register product".
  const unknownCode = useRef<string | null>(null);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const r = await cached('recent', () => listHistory({ limit: 40 }));
      setRecent(r.value);
      setRecentFromCache(r.fromCache);
    } catch {
      // keep what is shown
    } finally {
      setRecentLoading(false);
    }
  }, []);

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
          const list = locs.value.filter((l) => !plan.locked_locations.includes(l.id));
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
          loadRecent();
          if (unknownCode.current) findText([unknownCode.current], prods.value);
        } catch (e) {
          setMessage({ ok: false, text: (e as Error).message });
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const grades = useMemo(() => gradeList(recognition.data.terms), [recognition.data.terms]);
  const standard = useMemo(
    () => defaultGradeTerm(recognition.data.terms, recognition.data.defaultGradeId),
    [recognition.data.terms, recognition.data.defaultGradeId],
  );
  const standardId = standard?.id ?? null;

  /** The version of item p with this grade on this phone (active), or null if it is not made yet. */
  const findVersion = useCallback(
    (p: Product, grade: string | null): Product | null => {
      if (p.grade_id === grade) return p;
      if (!p.structured) return null;
      const key = familyKey(p);
      return products.find((x) => x.is_active && x.grade_id === grade && x.structured && familyKey(x) === key) ?? null;
    },
    [products],
  );

  /** Does a scan waiting on this phone go to this version (id, or not made yet: item key + grade)? */
  const queuedTo = useCallback(
    (q: QueuedScan, id: string | null, key: string, grade: string | null) => {
      if (!q.pick_grade) return id != null && q.product_id === id;
      const base = productById.get(q.product_id);
      return !!base && familyKey(base) === key && (q.grade_id ?? null) === grade;
    },
    [productById],
  );

  /** Stock of item p in this grade at a location, including scans still waiting to sync on this phone. */
  const versionStock = useCallback(
    (p: Product, grade: string | null, locationId: string | null) => {
      if (!locationId) return 0;
      const v = findVersion(p, grade);
      const key = familyKey(p);
      const saved = v ? (stockRows.find((s) => s.product_id === v.id && s.location_id === locationId)?.qty ?? 0) : 0;
      const waiting = queue
        .filter((q) => q.status === 'pending' && queuedTo(q, v?.id ?? null, key, grade))
        .reduce(
          (n, q) =>
            n + (q.to_id === locationId && q.kind === 'IN' ? q.qty : 0) - (q.from_id === locationId ? q.qty : 0),
          0,
        );
      return saved + waiting;
    },
    [findVersion, stockRows, queue, queuedTo],
  );
  const stockAt = useCallback(
    (locationId: string | null) => (product ? versionStock(product, gradeId, locationId) : 0),
    [product, gradeId, versionStock],
  );

  /**
   * Use this item. `grade` is the grade the name assigned (a grade in the text, or a recognition
   * entry). Leave it out to use the grade already stored for this lookup. A structured item with
   * no grade of its own uses the standard grade.
   */
  function choose(p: Product, learnIt = false, grade?: string | null) {
    if (learnIt && pickFor) recognition.learn(pickFor, p.id);
    const fromName = grade !== undefined ? grade : nameGrade;
    const g = !p.structured ? p.grade_id : (fromName ?? p.grade_id ?? standardId);
    setPickFor(null);
    setPicker(false);
    setProduct(p);
    setGradeId(g);
    unknownCode.current = null;
    setQty(mode === 'ADJUST' ? formatQty(versionStock(p, g, fromId)) : '1');
  }

  function chooseGrade(g: string | null) {
    setGradeId(g);
    if (product && mode === 'ADJUST') setQty(formatQty(versionStock(product, g, fromId)));
  }

  /** Exact barcode / code first; then up to five items, each line graded on its own. */
  function findText(blocks: string[], list: Product[] = products) {
    const text = blocks.join(' ').trim();
    if (!text) return;
    setMessage(null);
    setLookedUp(text);
    setPicker(false);
    const hits = identifyScanItems(blocks, list, recognition.dict, recognition.learned);
    setScanHits(hits);
    const parts = splitName(text, recognition.dict, true);
    setReadGrade(parts.gradeId);
    setNameGrade(hits[0]?.gradeId ?? mappedGradeId(parts, recognition.dict));
    const seen = new Set<string>();
    const found = hits.length
      ? hits.map((h) => ({ product: h.product, score: h.score, learned: h.learned }))
      : rankItems(blocks, list, recognition.dict, recognition.learned, 12)
          .filter((m) => !seen.has(familyKey(m.product)) && !!seen.add(familyKey(m.product)))
          .slice(0, 5);
    setMatches(found);
    if (hits.length === 1) {
      choose(hits[0].product, false, hits[0].gradeId);
    } else if (hits.length > 1) {
      setProduct(null);
      setPickFor(text);
      unknownCode.current = null;
    } else if (isSure(found)) {
      const mapped = mappedGradeId(parts, recognition.dict);
      choose(found[0].product, false, mapped);
    } else {
      setProduct(null);
      setPickFor(found.length ? text : null);
      unknownCode.current = found.length ? null : text;
    }
  }

  function reset() {
    unknownCode.current = null;
    setPickFor(null);
    setPicker(false);
    setCode('');
    setLookedUp(null);
    setReadText(null);
    setMatches([]);
    setScanHits([]);
    setProduct(null);
    setGradeId(null);
    setReadGrade(null);
    setNameGrade(null);
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

  // The version that is moved: the item itself, another grade of it, or one not made yet (null).
  const target = product ? findVersion(product, gradeId) : null;
  const targetName = product ? (target?.name ?? versionName(product, gradeId, recognition.dict)) : '';
  const versions = useMemo(
    () =>
      product
        ? gradeVersions(
            products.filter((p) => p.is_active),
            product,
            recognition.dict,
          )
        : [],
    [product, products, recognition.dict],
  );
  const showGrades = !!product?.structured && grades.length > 0;
  const gradeIsSpecial = showGrades && !!standard && gradeId !== standard.id;
  const gradeChoices: (string | null)[] = [
    ...(versions.some((v) => !v.grade_id) ? [null] : []),
    ...grades.map((g) => g.id),
  ];

  let problem: string | null = null;
  if (!product) problem = 'Scan or pick an item first';
  else if (!allowsDecimals(product.unit) && qty.trim() !== '' && !Number.isInteger(qtyNum))
    problem = `${product.unit} is counted in whole numbers (only KG takes decimals)`;
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
    const name = targetName;
    const newVersion = !target;
    try {
      if (mode === 'ADJUST') {
        await recordAdjustment({
          productId: showGrades ? product.id : (target?.id ?? product.id),
          locationId: fromId!,
          newQty: qtyNum,
          note,
          // Graded save finds or makes the version and keeps the first remark on it.
          grade: showGrades ? { id: gradeId } : undefined,
        });
        setMessage({ ok: true, text: `Saved: ${name} — ${summary}` });
      } else {
        const { queued } = await submitScan({
          kind: mode,
          product_id: showGrades ? product.id : (target?.id ?? product.id),
          product_name: name,
          ...(showGrades ? { pick_grade: true, grade_id: gradeId } : {}),
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
            ? `Saved on this phone: ${name} — ${summary}. It will be sent when you are back online.`
            : mode === 'TRANSFER'
              ? `Sent: ${name} — ${summary}. Waiting for ${toLoc?.code} to receive it.`
              : `Saved: ${name} — ${summary}`,
        });
      }
      reset();
      loadStock().catch(() => {});
      loadRecent();
      // A new grade version, or a remark just stored on one, should be on this phone next time.
      if (newVersion || (gradeIsSpecial && note.trim())) {
        cached('products', listProducts)
          .then((r) => setProducts(r.value))
          .catch(() => {});
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const step = (d: number) => setQty(String(Math.max(0, (Number(qty) || 0) + d)));
  /** Can this move be done again as it was, by me? */
  function canRedo(m: MovementRow) {
    if (!isRepeatable(m) || !modes.some((x) => x.kind === m.kind)) return false;
    if (m.kind === 'IN') return canUse(m.to_location_id);
    if (m.kind === 'OUT') return canUse(m.from_location_id);
    return canUse(m.from_location_id) && locations.some((l) => l.id === m.to_location_id);
  }

  /** Fill the form from a recent move (same product, type, locations, qty). */
  function useMove(m: MovementRow) {
    const p = products.find((x) => x.id === m.product_id);
    if (!p) {
      setMessage({ ok: false, text: `${m.product_name} is no longer an active product.` });
      return;
    }
    setLookedUp(null);
    setReadText(null);
    setMatches([]);
    setCode('');
    setNote('');
    if (canRedo(m)) {
      setMode(m.kind);
      if (m.from_location_id) setFromId(m.from_location_id);
      if (m.to_location_id) setToId(m.to_location_id);
      setProduct(p);
      setGradeId(p.grade_id);
      setReadGrade(null);
      setNameGrade(null);
      setQty(formatQty(m.qty));
      setMessage(null);
    } else {
      choose(p); // only the product: that move can't be redone as it was
      setMessage({ ok: true, text: `${p.name} selected. Pick the type and quantity.` });
    }
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  /** Do a recent move again as it was, after a confirm. */
  function repeatMove(m: MovementRow) {
    if (!canRedo(m)) {
      Alert.alert('Cannot repeat', 'You are not allowed to do this move at these locations.');
      return;
    }
    const p = products.find((x) => x.id === m.product_id);
    if (!p) {
      Alert.alert('Cannot repeat', `${m.product_name} is no longer an active product.`);
      return;
    }
    const have = m.from_location_id != null ? versionStock(p, p.grade_id, m.from_location_id) : Infinity;
    if (m.qty > have) {
      Alert.alert('Not enough stock', `Only ${formatQty(have)} ${p.unit} at ${m.from_code}.`);
      return;
    }
    const what = `${describeMove(m)}  ${formatQty(m.qty)} ${p.unit}  ${p.name}`;
    Alert.alert('Repeat this move?', what, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Repeat',
        onPress: async () => {
          try {
            const { queued } = await submitScan({
              kind: m.kind as 'IN' | 'OUT' | 'TRANSFER',
              product_id: p.id,
              product_name: p.name,
              unit: p.unit,
              qty: m.qty,
              from_id: m.from_location_id,
              to_id: m.kind === 'OUT' ? null : m.to_location_id,
              from_code: m.from_code,
              to_code: m.kind === 'OUT' ? null : m.to_code,
              note: m.note ?? '',
            });
            setMessage({
              ok: true,
              text: queued ? `Saved on this phone: ${what}. It will be sent when online.` : `Done: ${what}`,
            });
            loadStock().catch(() => {});
            loadRecent();
          } catch (e) {
            setMessage({ ok: false, text: (e as Error).message });
          }
        },
      },
    ]);
  }

  const myId = session?.user.id;
  const recentShown = recentFilter === 'mine' ? recent.filter((m) => m.created_by === myId) : recent;
  const sideBySide = width >= 820;

  const recentPanel = (
    <View style={!sideBySide ? { marginTop: 16 } : undefined}>
      <RecentMoves
        rows={recentShown}
        queued={queue}
        filter={recentFilter}
        onFilter={setRecentFilter}
        onUse={useMove}
        onRepeat={repeatMove}
        onRefresh={loadRecent}
        loading={recentLoading}
        offline={recentFromCache}
      />
    </View>
  );

  const pendingCount = queue.filter((q) => q.status === 'pending').length;
  const failedCount = queue.filter((q) => q.status === 'failed').length;
  const otherMatches = useMemo(
    () => (product ? matches.filter((m) => familyKey(m.product) !== familyKey(product)) : matches),
    [matches, product],
  );
  const readCategory = useMemo(
    () => (lookedUp ? splitName(lookedUp, recognition.dict, true).categoryId : null),
    [lookedUp, recognition.dict],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.screen, sideBySide && { flexDirection: 'row' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        style={sideBySide ? { flex: 1.15 } : undefined}
        contentContainerStyle={styles.pad}
        keyboardShouldPersistTaps="handled"
      >
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

        <View style={styles.row}>
          <Button
            title="Scan with camera"
            onPress={() => setCamera(true)}
            color={kindColor[mode]}
            style={{ flex: 1 }}
          />
          <Button
            title={picker ? 'Close list' : 'Pick by tapping'}
            variant="outline"
            color={kindColor[mode]}
            onPress={() => {
              setPicker((v) => !v);
              setMessage(null);
            }}
          />
        </View>
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

        {readText && <Text style={styles.muted}>Read from label: “{readText}”</Text>}

        {scanHits.length > 0 && (
          <Card style={{ gap: 8 }}>
            <Text style={styles.title}>
              {scanHits.length === 1 ? '1 item' : `${scanHits.length} items`}
            </Text>
            <Text style={styles.muted}>Tap a number to use that item. Each line keeps its own grade.</Text>
            {scanHits.map((h, i) => (
              <Pressable
                key={`${h.product.id}-${i}`}
                onPress={() => choose(h.product, true, h.gradeId)}
                style={({ pressed }) => [{ gap: 2 }, pressed && { opacity: 0.6 }]}
              >
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  {i + 1}. {h.product.name}
                </Text>
                <Text style={styles.muted}>
                  {h.product.structured ? `Grade ${gradeName(h.gradeId, recognition.dict)} · ` : ''}
                  {Math.round(h.score * 100)}%
                </Text>
              </Pressable>
            ))}
          </Card>
        )}

        {/* Find an item by tapping: Category → Grade → Label → Size → Brand */}
        {picker && !product && (
          <Card style={{ gap: 8 }}>
            <Text style={styles.title}>Pick the item</Text>
            <ItemPicker
              products={products}
              dict={recognition.dict}
              startCategory={readCategory}
              onPick={(p) => choose(p, !!lookedUp)}
            />
          </Card>
        )}

        {/* No clear match: let the user pick from the possible items */}
        {lookedUp && !product && !picker && scanHits.length === 0 && matches.length > 0 && (
          <Card style={{ gap: 8 }}>
            <Text style={styles.title}>Which item is it?</Text>
            <Text style={styles.muted}>Possible items for “{lookedUp}”, best first</Text>
            {matches.map((m) => (
              <MatchRow key={m.product.id} m={m} onPress={() => choose(m.product, true)} />
            ))}
            <Button title="Not here? Narrow down by tapping" variant="outline" onPress={() => setPicker(true)} />
          </Card>
        )}

        {lookedUp && !product && !picker && matches.length === 0 && !busy && (
          <Card>
            <Text style={styles.title}>No matching item</Text>
            <Text style={styles.muted}>{lookedUp}</Text>
            <Button title="Pick by tapping" variant="outline" onPress={() => setPicker(true)} />
            {can.manageProducts(role) ? (
              online ? (
                <Button
                  title="Register a new item"
                  onPress={() =>
                    router.push({
                      pathname: '/product/[id]',
                      params: readText ? { id: 'new', text: lookedUp } : { id: 'new', barcode: lookedUp },
                    })
                  }
                />
              ) : (
                <Text style={{ color: colors.text }}>Adding products needs internet.</Text>
              )
            ) : (
              <Text style={{ color: colors.text }}>Ask your Team Leader or an Oversee to register this item.</Text>
            )}
          </Card>
        )}

        {product && (
          <Card>
            <Text style={styles.title}>{targetName}</Text>
            <Text style={styles.muted}>{target ? target.barcode : 'New grade version: it gets its own code'}</Text>
            {showGrades && (
              <View style={{ gap: 6, marginTop: 4 }}>
                <Text style={styles.label}>Grade</Text>
                <View style={styles.chipRow}>
                  {gradeChoices.map((g) => (
                    <Chip
                      key={g ?? 'none'}
                      label={gradeName(g, recognition.dict)}
                      active={gradeId === g}
                      color={kindColor[mode]}
                      onPress={() => chooseGrade(g)}
                    />
                  ))}
                </View>
                {readGrade && readGrade !== gradeId && (
                  <Text style={{ color: colors.warn, fontWeight: '600' }}>
                    The label says grade {gradeName(readGrade, recognition.dict)}
                  </Text>
                )}
                {nameGrade && nameGrade !== gradeId && nameGrade !== readGrade && (
                  <Text style={{ color: colors.warn, fontWeight: '600' }}>
                    Recognition assigns grade {gradeName(nameGrade, recognition.dict)}
                  </Text>
                )}
                {standard && (
                  <Text style={styles.muted}>
                    Standard grade: {standard.name}
                    {gradeId !== standard.id ? '. Add a remark for this grade.' : '.'}
                  </Text>
                )}
                {!target && (
                  <Text style={styles.muted}>
                    {mode === 'IN' || mode === 'ADJUST'
                      ? `No ${gradeName(gradeId, recognition.dict)} version of this item yet. It is made when you save.`
                      : `There is no ${gradeName(gradeId, recognition.dict)} stock of this item.`}
                  </Text>
                )}
              </View>
            )}
            <View style={{ gap: 2, marginTop: 6 }}>
              {mine.map((l) => {
                const shown = showGrades ? versions : [product];
                const list = shown.map((v) => ({ v, n: versionStock(v, v.grade_id, l.id) }));
                if (showGrades && !target) list.push({ v: product, n: 0 }); // the version about to be made
                const many = list.length > 1;
                return (
                  <Text key={l.id} style={{ color: colors.text }}>
                    {l.code}:{' '}
                    {many
                      ? list.map(({ v, n }, i) => {
                          const g = i === shown.length ? gradeId : v.grade_id;
                          const sel = g === gradeId;
                          return (
                            <Text key={g ?? 'none'} style={sel ? { fontWeight: '800', color: kindColor[mode] } : null}>
                              {i ? '  ·  ' : ''}
                              {gradeShort(g, recognition.dict)} {formatQty(n)}
                            </Text>
                          );
                        })
                      : null}
                    {many ? (
                      <Text style={styles.muted}> = {formatQty(list.reduce((t, x) => t + x.n, 0))}</Text>
                    ) : (
                      <Text style={{ fontWeight: '700' }}>{formatQty(stockAt(l.id))}</Text>
                    )}
                  </Text>
                );
              })}
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
                      onPress={() => {
                        if (lookedUp) recognition.learn(lookedUp, m.product.id);
                        choose(m.product);
                      }}
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
                style={[
                  styles.input,
                  { flex: 1, minWidth: 0, textAlign: 'center', fontSize: fs(22), fontWeight: '700' },
                ]}
                keyboardType={allowsDecimals(product.unit) ? 'decimal-pad' : 'number-pad'}
                value={qty}
                onChangeText={setQty}
                selectTextOnFocus
              />
              <Button title="+" variant="outline" onPress={() => step(1)} style={{ width: 56 }} />
            </View>
            {target?.grade_note ? <Text style={styles.muted}>Item remark: {target.grade_note}</Text> : null}
            <Field
              label={gradeIsSpecial ? 'Note / Remark' : 'Note (optional)'}
              value={note}
              onChangeText={setNote}
              maxLength={400}
              placeholder={
                gradeIsSpecial
                  ? `Why this is grade ${gradeName(gradeId, recognition.dict)}, not ${standard?.name ?? 'the standard grade'}`
                  : isAdjust
                    ? 'e.g. stock count, damaged'
                    : 'e.g. supplier, invoice no.'
              }
            />

            {problem && <Text style={{ color: colors.out }}>{problem}</Text>}
            <Button title={`${summary}`} color={kindColor[mode]} onPress={submit} loading={busy} disabled={!!problem} />
            <Button title="Cancel" variant="outline" color={colors.muted} onPress={reset} />
          </Card>
        )}
        {!sideBySide && recentPanel}
      </ScrollView>

      {sideBySide && (
        <ScrollView
          style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: colors.border }}
          contentContainerStyle={styles.pad}
        >
          {recentPanel}
        </ScrollView>
      )}

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

const PART_LABEL = { category: 'Category', grade: 'Grade', label: 'Label', size: 'Size', brand: 'Brand', mark: 'Mark' };

function MatchRow({ m, onPress }: { m: ItemMatch; onPress: () => void }) {
  const pct = Math.round(m.score * 100);
  const checks = Object.entries(m.checks ?? {}).filter(([, v]) => v !== 'unread') as [
    keyof typeof PART_LABEL,
    'match' | 'differs',
  ][];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { flexDirection: 'row', alignItems: 'center' },
        m.sizeDiffers && { borderColor: colors.warn },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title}>{m.product.name}</Text>
        {checks.length > 0 && (
          <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
            {checks.map(([k, v]) => (
              <Text
                key={k}
                style={{ fontSize: fs(12), fontWeight: '700', color: v === 'match' ? colors.in : colors.out }}
              >
                {v === 'match' ? '✓' : '✗'} {PART_LABEL[k]}
                {k === 'size' && v === 'differs' ? ' differs' : ''}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.muted}>
          {m.product.barcode} · {m.product.unit}
          {m.learned ? ' · picked before for this text' : ''}
        </Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{pct}%</Text>
    </Pressable>
  );
}
