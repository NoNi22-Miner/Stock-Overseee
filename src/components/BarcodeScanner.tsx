import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { extractTextFromImage, isSupported as ocrSupported } from 'expo-text-extractor';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, themed } from '../lib/theme';
import { Button } from './ui';

const BARCODE_TYPES: BarcodeType[] = [
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code128',
  'code39',
  'code93',
  'itf14',
  'codabar',
  'qr',
  'datamatrix',
];

type Mode = 'barcode' | 'words';

/**
 * Full-screen camera.
 * - Barcode: returns the first barcode it reads.
 * - Words: takes a photo and returns the text read inside the box (on the phone, no internet),
 *   e.g. one item name line on a Delivery Order.
 */
export function BarcodeScanner({
  visible,
  onClose,
  onScanned,
  onText,
  initialMode = 'barcode',
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
  /** When given, the Words mode is offered. Receives the text blocks read from the photo. */
  onText?: (blocks: string[]) => void;
  initialMode?: Mode;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [mode, setMode] = useState<Mode>(onText ? initialMode : 'barcode');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handled = useRef(false);
  const camera = useRef<CameraView>(null);
  const [view, setView] = useState({ width: 0, height: 0 });

  async function readWords() {
    if (!camera.current || reading) return;
    setProblem(null);
    setReading(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!photo?.uri) throw new Error('No photo');
      const read = async (uri: string) => (await extractTextFromImage(uri)).map((b) => b.trim()).filter(Boolean);
      let blocks: string[] = [];
      try {
        const boxUri = await cropToBox(photo, view, frameBox(view.width, view.height, true));
        if (boxUri) blocks = await read(boxUri);
      } catch {
        // could not crop: read the whole photo below
      }
      // Nothing in the box (or it could not be cut out): read the whole photo instead.
      if (!blocks.length) blocks = await read(photo.uri);
      if (!blocks.length) {
        setProblem('No words found. Put the item name inside the box, hold steady, and make sure it is lit.');
        return;
      }
      onText?.(blocks);
    } catch (e) {
      setProblem(`Could not read the words: ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  const wordsMode = mode === 'words';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onShow={() => {
        handled.current = false;
        setProblem(null);
      }}
      onRequestClose={onClose}
    >
      <SafeAreaView style={s.root}>
        {!permission ? null : !permission.granted ? (
          <View style={s.center}>
            <Text style={s.msg}>Camera access is needed to scan.</Text>
            <Button title="Allow camera" onPress={requestPermission} />
            <Button title="Cancel" variant="outline" color="#fff" onPress={onClose} />
          </View>
        ) : (
          <>
            <View
              style={StyleSheet.absoluteFill}
              onLayout={(e: LayoutChangeEvent) =>
                setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
              }
            >
              <CameraView
                ref={camera}
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={torch}
                barcodeScannerSettings={wordsMode ? undefined : { barcodeTypes: BARCODE_TYPES }}
                onBarcodeScanned={
                  wordsMode
                    ? undefined
                    : ({ data }) => {
                        if (handled.current || !data) return;
                        handled.current = true;
                        onScanned(data.trim());
                      }
                }
              />
              {view.width > 0 && (
                <View style={[s.frame, frameBox(view.width, view.height, wordsMode)]} pointerEvents="none" />
              )}
            </View>

            <View style={s.top}>
              {onText && (
                <View style={s.modeRow}>
                  {(['barcode', 'words'] as Mode[]).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => {
                        setMode(m);
                        setProblem(null);
                      }}
                      style={[s.modeBtn, mode === m && s.modeBtnActive]}
                    >
                      <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                        {m === 'barcode' ? 'Barcode' : 'Words'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={s.hint}>
                {wordsMode
                  ? 'Put one item name line inside the box, then tap Read words'
                  : 'Point the camera at a barcode'}
              </Text>
              {wordsMode && !ocrSupported && (
                <Text style={s.problem}>Reading words is not supported on this device.</Text>
              )}
              {problem && <Text style={s.problem}>{problem}</Text>}
            </View>

            <View style={s.bar}>
              <Pressable style={s.barBtn} onPress={() => setTorch((t) => !t)}>
                <Text style={s.barText}>{torch ? 'Light off' : 'Light on'}</Text>
              </Pressable>
              {wordsMode && (
                <Pressable style={[s.barBtn, s.readBtn]} onPress={readWords} disabled={reading}>
                  {reading ? <ActivityIndicator color="#fff" /> : <Text style={s.barText}>Read words</Text>}
                </Pressable>
              )}
              <Pressable style={s.barBtn} onPress={onClose}>
                <Text style={s.barText}>Close</Text>
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/** The aiming box in the middle of the camera view: wide and low for a line of text. */
function frameBox(w: number, h: number, words: boolean) {
  const width = words ? Math.min(560, w * 0.9) : Math.min(280, w * 0.8);
  const height = words ? Math.min(120, h * 0.2) : Math.min(140, h * 0.3);
  return { width, height, left: (w - width) / 2, top: (h - height) / 2 };
}

/**
 * Cuts the photo down to the box (plus a small margin). The preview fills the view the way the
 * photo would ("cover"), so the box maps to the middle of the photo by the same scale.
 * Returns null when the photo is turned differently from the screen.
 */
async function cropToBox(
  photo: { uri: string; width: number; height: number },
  view: { width: number; height: number },
  box: { left: number; top: number; width: number; height: number },
) {
  const { width: pw, height: ph } = photo;
  if (!pw || !ph || !view.width || !view.height) return null;
  if (pw > ph !== view.width > view.height) return null;
  const scale = Math.max(view.width / pw, view.height / ph);
  const offX = (pw * scale - view.width) / 2;
  const offY = (ph * scale - view.height) / 2;
  const marginX = box.width * 0.06;
  const marginY = box.height * 0.25;
  const x = Math.max(0, (box.left - marginX + offX) / scale);
  const y = Math.max(0, (box.top - marginY + offY) / scale);
  const width = Math.min(pw - x, (box.width + 2 * marginX) / scale);
  const height = Math.min(ph - y, (box.height + 2 * marginY) / scale);
  if (width < 20 || height < 10) return null;
  const ctx = ImageManipulator.manipulate(photo.uri);
  ctx.crop({ originX: Math.round(x), originY: Math.round(y), width: Math.round(width), height: Math.round(height) });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  return saved.uri;
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
    msg: { color: '#fff', fontSize: 16, textAlign: 'center' },
    frame: { position: 'absolute', borderWidth: 3, borderColor: colors.primaryText, borderRadius: 14 },
    top: { position: 'absolute', top: 24, left: 16, right: 16, alignItems: 'center', gap: 10 },
    modeRow: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
    modeBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
    modeBtnActive: { backgroundColor: '#fff' },
    modeText: { color: '#fff', fontWeight: '700' },
    modeTextActive: { color: colors.text },
    hint: { color: '#fff', fontSize: 15, textAlign: 'center' },
    problem: {
      color: '#fff',
      backgroundColor: 'rgba(198,40,40,0.85)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      textAlign: 'center',
    },
    bar: {
      position: 'absolute',
      bottom: 32,
      left: 16,
      right: 16,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    barBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
    readBtn: { backgroundColor: colors.primary, paddingHorizontal: 28, minWidth: 130, alignItems: 'center' },
    barText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  }),
);
