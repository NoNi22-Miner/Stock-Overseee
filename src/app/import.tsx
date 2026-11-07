import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Text, View } from 'react-native';
import { Button, Card, Chip, styles } from '../components/ui';
import { importItems, listProducts } from '../lib/api';
import { checkImport, TEMPLATE_EXAMPLE, TEMPLATE_HEADER, type ImportCheck, type ImportStatus } from '../lib/itemImport';
import { cached, cacheSet, useOnline } from '../lib/offline';
import { useRecognition } from '../lib/recognition';
import { colors, themed } from '../lib/theme';
import type { Product } from '../lib/types';
import { readCsv, readXlsx, writeXlsx } from '../lib/xlsx';

const STATUS = themed<Record<ImportStatus, { label: string; color: string }>>(() => ({
  new: { label: 'New', color: colors.in },
  exists: { label: 'Already in the app', color: colors.muted },
  repeat: { label: 'Repeated in the file', color: colors.muted },
  problem: { label: 'Not understood', color: colors.out },
}));

async function fileBytes(asset: DocumentPicker.DocumentPickerAsset): Promise<Uint8Array> {
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
  return new File(asset.uri).bytes();
}

/** Team Leader / Oversee: add many items at once from an Excel file. */
export default function ImportScreen() {
  const online = useOnline();
  const { dict, reload } = useRecognition();
  const [products, setProducts] = useState<Product[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [show, setShow] = useState<ImportStatus | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    cached('products', listProducts)
      .then((r) => setProducts(r.value))
      .catch(() => {});
  }, []);

  const check: ImportCheck | null = useMemo(
    () => (sheet ? checkImport(sheet, dict, products) : null),
    [sheet, dict, products],
  );
  const counts = useMemo(() => {
    const c: Record<ImportStatus, number> = { new: 0, exists: 0, repeat: 0, problem: 0 };
    check?.rows.forEach((r) => c[r.status]++);
    return c;
  }, [check]);
  const rows = check?.rows.filter((r) => show === 'all' || r.status === show) ?? [];

  async function pick() {
    setDone(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/comma-separated-values',
          'application/octet-stream',
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setBusy(true);
      const bytes = await fileBytes(asset);
      const isCsv = /\.csv$/i.test(asset.name) || asset.mimeType?.includes('csv');
      const rowsRead = isCsv ? readCsv(new TextDecoder().decode(bytes)) : readXlsx(bytes);
      await reload();
      setFileName(asset.name);
      setSheet(rowsRead);
      setShow('all');
    } catch (e) {
      Alert.alert('Could not read the file', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    try {
      const bytes = writeXlsx([TEMPLATE_HEADER, TEMPLATE_EXAMPLE]);
      if (Platform.OS === 'web') {
        const blob = new Blob([bytes as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'item-import-template.xlsx';
        a.click();
        return;
      }
      const file = new File(Paths.cache, 'item-import-template.xlsx');
      file.create({ overwrite: true });
      await file.write(bytes);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Item import template',
      });
    } catch (e) {
      Alert.alert('Could not make the template', (e as Error).message);
    }
  }

  async function save() {
    if (!check) return;
    const items = check.rows.filter((r) => r.status === 'new' && r.item).map((r) => r.item!);
    if (!items.length) return;
    setBusy(true);
    try {
      let added = 0;
      let skipped = 0;
      let lists = 0;
      for (let i = 0; i < items.length; i += 500) {
        const r = await importItems(items.slice(i, i + 500));
        added += r.added;
        skipped += r.skipped;
        lists += r.new_list_entries;
      }
      const fresh = await listProducts();
      cacheSet('products', fresh);
      setProducts(fresh);
      await reload();
      setSheet(null);
      setDone(
        `Added ${added} item${added === 1 ? '' : 's'}` +
          (skipped ? `, ${skipped} already existed` : '') +
          (lists ? `, ${lists} new Recognition Table entr${lists === 1 ? 'y' : 'ies'}` : '') +
          '.',
      );
    } catch (e) {
      Alert.alert('Import failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.pad, { paddingBottom: 40 }]}
      data={rows}
      keyExtractor={(r) => String(r.row)}
      initialNumToRender={30}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Card>
            <Text style={styles.title}>Two ways to import</Text>
            <Text style={{ color: colors.text }}>
              1. A list of item names, one per row (like the item list from your DO system). Each name is split with the
              Recognition Table.
            </Text>
            <Text style={{ color: colors.text }}>
              2. The template: Category · Grade · Label 1-3 · Size 1-5 · Brand · Mark · Unit · Min stock · Code. Missing
              categories, labels and brands are added.
            </Text>
            <Text style={styles.muted}>Nothing is saved until you check the list and tap Import.</Text>
          </Card>
          <View style={styles.row}>
            <Button title="Pick Excel file" style={{ flex: 1 }} onPress={pick} loading={busy && !sheet} />
            <Button title="Template" variant="outline" onPress={template} />
          </View>
          {done && (
            <Card style={{ borderColor: colors.in }}>
              <Text style={{ color: colors.in, fontWeight: '700' }}>{done}</Text>
              <Button title="See the items" variant="outline" onPress={() => router.back()} />
            </Card>
          )}
          {check && (
            <>
              <Text style={styles.title}>
                {fileName} · {check.layout === 'template' ? 'template' : 'item names'}
              </Text>
              <View style={styles.chipRow}>
                <Chip label={`All ${check.rows.length}`} active={show === 'all'} onPress={() => setShow('all')} />
                {(Object.keys(STATUS) as ImportStatus[]).map((s) =>
                  counts[s] ? (
                    <Chip
                      key={s}
                      label={`${STATUS[s].label} ${counts[s]}`}
                      active={show === s}
                      color={STATUS[s].color}
                      onPress={() => setShow(s)}
                    />
                  ) : null,
                )}
              </View>
              {check.newEntries.length > 0 && (
                <Text style={{ color: colors.text }}>
                  Will be added to the Recognition Table: {check.newEntries.join(', ')}
                </Text>
              )}
              {counts.problem > 0 && (
                <Text style={{ color: colors.out }}>
                  Rows not understood are skipped. Add the missing words to the Recognition Table (or fix the file),
                  then pick the file again.
                </Text>
              )}
              {!online && <Text style={{ color: colors.out }}>Importing needs internet.</Text>}
              <Button
                title={
                  counts.new ? `Import ${counts.new} new item${counts.new === 1 ? '' : 's'}` : 'Nothing new to import'
                }
                onPress={save}
                loading={busy}
                disabled={!counts.new || !online}
              />
            </>
          )}
        </View>
      }
      renderItem={({ item: r }) => (
        <View style={[styles.card, { borderLeftWidth: 5, borderLeftColor: STATUS[r.status].color }]}>
          <Text style={styles.muted}>
            Row {r.row} · {STATUS[r.status].label}
            {r.item ? ` · ${r.item.unit}` : ''}
          </Text>
          <Text style={styles.title}>{r.name ?? r.source}</Text>
          {r.name && r.name !== r.source && <Text style={styles.muted}>From: {r.source}</Text>}
          {r.problem && <Text style={{ color: r.status === 'problem' ? colors.out : colors.muted }}>{r.problem}</Text>}
        </View>
      )}
    />
  );
}
