import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { extractTextFromImage, isSupported as ocrSupported } from 'expo-text-extractor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fs, themed } from '../lib/theme';
import { Button, Text } from './ui';

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
type Shape = 'wide' | 'tall';
type Rect = { left: number; top: number; width: number; height: number };
type Corner = 'tl' | 'tr' | 'bl' | 'br';

/**
 * Full-screen camera.
 * - Barcode: returns the first barcode it reads.
 * - Words: reads the text inside the frame (on the phone, no internet). The frame is wide enough
 *   for a Delivery Order item table: the No column on the left through the quantity columns on
 *   the right, and up to five numbered lines. Drag the corners to fit the paper. Turn the frame
 *   when the photo is taken sideways.
 */
export function BarcodeScanner(props: {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
  /** When given, the Words mode is offered. Receives the text blocks read from the photo. */
  onText?: (blocks: string[]) => void;
  initialMode?: Mode;
}) {
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaProvider>
        <ScannerBody {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

function ScannerBody({
  onClose,
  onScanned,
  onText,
  initialMode = 'barcode',
}: {
  onClose: () => void;
  onScanned: (code: string) => void;
  onText?: (blocks: string[]) => void;
  initialMode?: Mode;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [mode, setMode] = useState<Mode>(onText ? initialMode : 'barcode');
  const [shape, setShape] = useState<Shape>('wide');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handled = useRef(false);
  const camera = useRef<CameraView>(null);
  const [view, setView] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<Rect | null>(null);
  const frameRef = useRef<Rect | null>(null);

  useEffect(() => {
    if (!view.width || !view.height || mode !== 'words') return;
    const next = defaultWordsFrame(view.width, view.height, shape);
    frameRef.current = next;
    setFrame(next);
  }, [view.width, view.height, shape, mode]);

  const wordsMode = mode === 'words';
  const box = wordsMode && frame ? frame : frameBox(view.width, view.height, false);

  async function readWords() {
    if (!camera.current || reading) return;
    setProblem(null);
    setReading(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!photo?.uri) throw new Error('No photo');
      const read = async (uri: string) => (await extractTextFromImage(uri)).map((b) => b.trim()).filter(Boolean);
      const aim = frameRef.current ?? defaultWordsFrame(view.width, view.height, shape);
      let blocks: string[] = [];
      try {
        const aligned = await alignToView(photo, view);
        const boxUri = await cropToBox(aligned, view, aim);
        if (boxUri) blocks = await read(boxUri);
      } catch {
        // could not crop: read the whole photo below
      }
      if (!blocks.length) blocks = await read(photo.uri);
      if (!blocks.length) {
        setProblem('No words found. Fit the item table in the frame, hold steady, and make sure it is lit.');
        return;
      }
      onText?.(blocks);
    } catch (e) {
      setProblem(`Could not read the words: ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  const corners = useMemo(() => {
    const make = (corner: Corner) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = frameRef.current;
        },
        onPanResponderMove: (_, g) => {
          const start = dragStart.current;
          if (!start || !view.width) return;
          const next = clampRect(resizeCorner(start, corner, g.dx, g.dy), view.width, view.height);
          frameRef.current = next;
          setFrame(next);
        },
      });
    const dragStart = { current: null as Rect | null };
    return { tl: make('tl'), tr: make('tr'), bl: make('bl'), br: make('br') };
  }, [view.width, view.height]);

  return (
    <View style={s.root}>
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
            {view.width > 0 && <View style={[s.frame, box]} pointerEvents="none" />}
            {wordsMode && frame && (
              <>
                <Handle style={{ left: frame.left - 18, top: frame.top - 18 }} responder={corners.tl} />
                <Handle style={{ left: frame.left + frame.width - 18, top: frame.top - 18 }} responder={corners.tr} />
                <Handle style={{ left: frame.left - 18, top: frame.top + frame.height - 18 }} responder={corners.bl} />
                <Handle style={{ left: frame.left + frame.width - 18, top: frame.top + frame.height - 18 }} responder={corners.br} />
              </>
            )}
          </View>

          <View style={[s.top, { top: insets.top + 8 }]}>
            {onText && (
              <View style={s.modeRow}>
                {(['barcode', 'words'] as Mode[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMode(m);
                      setProblem(null);
                      handled.current = false;
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
                ? 'Fit the whole item table in the frame: the numbers on the left through the quantities on the right. Up to 5 lines. Drag the corners. Turn the frame if the paper is sideways.'
                : 'Point the camera at a barcode'}
            </Text>
            {wordsMode && !ocrSupported && <Text style={s.problem}>Reading words is not supported on this device.</Text>}
            {problem && <Text style={s.problem}>{problem}</Text>}
          </View>

          <View style={[s.bar, { bottom: Math.max(insets.bottom, 16) + 56 }]}>
            <Pressable style={s.barBtn} onPress={() => setTorch((t) => !t)}>
              <Text style={s.barText}>{torch ? 'Light off' : 'Light on'}</Text>
            </Pressable>
            {wordsMode && (
              <Pressable
                style={s.barBtn}
                onPress={() => setShape((current) => (current === 'wide' ? 'tall' : 'wide'))}
              >
                <Text style={s.barText}>{shape === 'wide' ? 'Tall frame' : 'Wide frame'}</Text>
              </Pressable>
            )}
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
    </View>
  );
}

function Handle({ style, responder }: { style: { left: number; top: number }; responder: { panHandlers: object } }) {
  return <View style={[s.handle, style]} {...responder.panHandlers} />;
}

/** Wide: a landscape table (No … Qty). Tall: the same table when the paper is photographed sideways. */
function defaultWordsFrame(w: number, h: number, shape: Shape): Rect {
  if (shape === 'tall') {
    const height = h * 0.74;
    const width = Math.min(w * 0.58, height * 0.5);
    return clampRect({ left: (w - width) / 2, top: h * 0.1, width, height }, w, h);
  }
  const width = w * 0.94;
  const height = Math.min(h * 0.48, Math.max(168, width * 0.55));
  return clampRect({ left: (w - width) / 2, top: Math.max(96, (h - height) / 2 - h * 0.06), width, height }, w, h);
}

function resizeCorner(start: Rect, corner: Corner, dx: number, dy: number): Rect {
  const next = { ...start };
  if (corner === 'tl' || corner === 'bl') {
    next.left = start.left + dx;
    next.width = start.width - dx;
  } else {
    next.width = start.width + dx;
  }
  if (corner === 'tl' || corner === 'tr') {
    next.top = start.top + dy;
    next.height = start.height - dy;
  } else {
    next.height = start.height + dy;
  }
  return next;
}

function clampRect(rect: Rect, w: number, h: number): Rect {
  const minW = 120;
  const minH = 96;
  let { left, top, width, height } = rect;
  width = Math.max(minW, Math.min(width, w - 8));
  height = Math.max(minH, Math.min(height, h - 8));
  left = Math.max(4, Math.min(left, w - width - 4));
  top = Math.max(4, Math.min(top, h - height - 4));
  return { left, top, width, height };
}

/** The aiming box in the middle of the camera view. Words uses defaultWordsFrame instead. */
function frameBox(w: number, h: number, words: boolean) {
  if (!w || !h) return { width: 0, height: 0, left: 0, top: 0 };
  if (words) return defaultWordsFrame(w, h, 'wide');
  const width = Math.min(260, w * 0.72);
  const height = Math.min(120, h * 0.22);
  return { width, height, left: (w - width) / 2, top: (h - height) / 2 };
}

/**
 * Turns the saved photo so it matches the screen. Phone cameras often save a landscape file while
 * the preview is portrait; without this the crop would miss the frame.
 */
async function alignToView(
  photo: { uri: string; width: number; height: number },
  view: { width: number; height: number },
) {
  const { width: pw, height: ph, uri } = photo;
  if (!pw || !ph || !view.width || !view.height) return photo;
  if (pw > ph === view.width > view.height) return photo;
  const ctx = ImageManipulator.manipulate(uri);
  ctx.rotate(90);
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: saved.uri, width: ph, height: pw };
}

/**
 * Cuts the photo down to the frame the person sees (plus a small margin so the No column and the
 * quantities are not clipped). The preview fills the view ("cover"), so the frame maps onto the
 * photo by that same scale.
 */
async function cropToBox(
  photo: { uri: string; width: number; height: number },
  view: { width: number; height: number },
  box: Rect,
) {
  const { width: pw, height: ph } = photo;
  if (!pw || !ph || !view.width || !view.height) return null;
  if (pw > ph !== view.width > view.height) return null;
  const scale = Math.max(view.width / pw, view.height / ph);
  const offX = (pw * scale - view.width) / 2;
  const offY = (ph * scale - view.height) / 2;
  const marginX = box.width * 0.03;
  const marginY = box.height * 0.04;
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
    msg: { color: '#fff', fontSize: fs(16), textAlign: 'center' },
    frame: { position: 'absolute', borderWidth: 3, borderColor: colors.primaryText, borderRadius: 12 },
    handle: {
      position: 'absolute',
      width: 36,
      height: 36,
      borderRadius: 8,
      borderWidth: 3,
      borderColor: '#fff',
      backgroundColor: colors.primary,
    },
    top: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 10 },
    modeRow: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 4 },
    modeBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 },
    modeBtnActive: { backgroundColor: '#fff' },
    modeText: { color: '#fff', fontWeight: '700' },
    modeTextActive: { color: colors.text },
    hint: { color: '#fff', fontSize: fs(14), textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: 8, borderRadius: 8 },
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
      left: 12,
      right: 12,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    barBtn: {
      backgroundColor: 'rgba(0,0,0,0.6)',
      paddingHorizontal: 16,
      minHeight: 56,
      paddingVertical: 14,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    readBtn: { backgroundColor: colors.primary, paddingHorizontal: 22, minWidth: 148 },
    barText: { color: '#fff', fontWeight: '700', fontSize: fs(16) },
  }),
);
