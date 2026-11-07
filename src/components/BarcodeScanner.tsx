import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { extractTextFromImage, isSupported as ocrSupported } from 'expo-text-extractor';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';
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
 * - Words: takes a photo of the label and returns the text read from it (on the phone, no internet).
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
  const screen = useWindowDimensions();

  async function readWords() {
    if (!camera.current || reading) return;
    setProblem(null);
    setReading(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) throw new Error('No photo');
      const blocks = (await extractTextFromImage(photo.uri)).map((b) => b.trim()).filter(Boolean);
      if (!blocks.length) {
        setProblem('No words found. Move closer, hold steady, and make sure the label is lit.');
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
            <View style={[s.frame, frameBox(screen.width, screen.height, wordsMode)]} pointerEvents="none" />

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
                {wordsMode ? 'Fit the label text inside the box, then tap Read words' : 'Point the camera at a barcode'}
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

/** A compact aiming box in the middle of the screen (never more than 80% of its width). */
function frameBox(w: number, h: number, words: boolean) {
  const width = Math.min(words ? 420 : 280, w * 0.8);
  const height = Math.min(words ? 180 : 140, h * 0.3);
  return { width, height, left: (w - width) / 2, top: (h - height) / 2 };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  msg: { color: '#fff', fontSize: 16, textAlign: 'center' },
  frame: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: colors.primaryText,
    borderRadius: 14,
  },
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
});
