import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

/** Full-screen camera that returns the first barcode it reads, then closes. */
export function BarcodeScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const handled = useRef(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onShow={() => {
        handled.current = false;
      }}
      onRequestClose={onClose}
    >
      <SafeAreaView style={s.root}>
        {!permission ? null : !permission.granted ? (
          <View style={s.center}>
            <Text style={s.msg}>Camera access is needed to scan barcodes.</Text>
            <Button title="Allow camera" onPress={requestPermission} />
            <Button title="Cancel" variant="outline" color="#fff" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={({ data }) => {
                if (handled.current || !data) return;
                handled.current = true;
                onScanned(data.trim());
              }}
            />
            <View style={s.frame} pointerEvents="none" />
            <View style={s.bar}>
              <Pressable style={s.barBtn} onPress={() => setTorch((t) => !t)}>
                <Text style={s.barText}>{torch ? 'Light off' : 'Light on'}</Text>
              </Pressable>
              <Pressable style={s.barBtn} onPress={onClose}>
                <Text style={s.barText}>Close</Text>
              </Pressable>
            </View>
            <Text style={s.hint}>Point the camera at a barcode</Text>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  msg: { color: '#fff', fontSize: 16, textAlign: 'center' },
  frame: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: '35%',
    height: '22%',
    borderWidth: 3,
    borderColor: colors.primaryText,
    borderRadius: 16,
  },
  bar: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  barText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  hint: { position: 'absolute', top: 48, alignSelf: 'center', color: '#fff', fontSize: 15 },
});
