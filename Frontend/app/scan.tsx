import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScannerEnabled, setIsScannerEnabled] = useState(true);
  const scanLockRef = useRef(false);
  const alertOpenRef = useRef(false);

  const goBackSafe = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/calories');
  };

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const resetScanner = () => {
    scanLockRef.current = false;
    alertOpenRef.current = false;
    setIsProcessing(false);
    setIsScannerEnabled(true);
  };

  const handleBarcodeScanned = async (rawData: string) => {
    if (!isScannerEnabled || isProcessing || scanLockRef.current || alertOpenRef.current) return;

    const barcode = `${rawData || ''}`.trim();
    const normalized = barcode.replace(/\s+/g, '');

    if (!/^\d{8,14}$/.test(normalized)) {
      Alert.alert('Invalid Barcode', 'Please scan a valid food barcode (8 to 14 digits).', [
        {
          text: 'Try Again',
          onPress: resetScanner,
        },
        {
          text: 'Back',
          onPress: goBackSafe,
          style: 'cancel',
        },
      ]);
      alertOpenRef.current = true;
      return;
    }

    scanLockRef.current = true;
    setIsScannerEnabled(false);
    setIsProcessing(true);

    try {
      router.replace({ pathname: '/food-details', params: { barcode: normalized } });
    } catch (error) {
      Alert.alert('Error', 'Failed to scan barcode.', [
        {
          text: 'Try Again',
          onPress: resetScanner,
        },
        {
          text: 'Back',
          onPress: goBackSafe,
          style: 'cancel',
        },
      ]);
      alertOpenRef.current = true;
      setIsProcessing(false);
    }
  };

  if (!permission || !permission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <View style={styles.permissionContent}>
          <FontAwesome name="camera" size={64} color="#9ca3af" />
          <Text style={styles.permissionTitle}>Camera permission required</Text>
          <Text style={styles.permissionSubtitle}>Allow camera access to scan food barcodes.</Text>

          <TouchableOpacity
            style={styles.allowButton}
            onPress={requestPermission}
          >
            <Text style={styles.allowButtonText}>Allow Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={goBackSafe}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraWrapper}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={isScannerEnabled && !isProcessing ? ({ data }) => handleBarcodeScanned(data) : undefined}
          barcodeScannerSettings={{
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
          }}
        />

        <View style={styles.overlay}>
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.iconButton} onPress={goBackSafe}>
              <FontAwesome name="chevron-left" size={18} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Scan</Text>
          </View>

          <View style={styles.centerContent}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <Text style={styles.frameText}>Place barcode inside the frame</Text>
          </View>

          <TouchableOpacity style={styles.cancelButton} onPress={goBackSafe}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {isProcessing ? (
          <View style={styles.processingOverlay}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.processingText}>Processing...</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraWrapper: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.72)',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  centerContent: {
    alignItems: 'center',
  },
  scanFrame: {
    width: 270,
    height: 270,
    borderRadius: 28,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderColor: '#fff',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 24,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 24,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 24,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: 24,
  },
  frameText: {
    marginTop: 14,
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    opacity: 0.92,
  },
  cancelButton: {
    alignSelf: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(17, 24, 39, 0.72)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  cancelText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  processingText: {
    marginTop: 8,
    color: '#fff',
    fontWeight: '600',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionContent: {
    alignItems: 'center',
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 18,
  },
  permissionSubtitle: {
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    fontSize: 15,
  },
  allowButton: {
    width: '100%',
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  allowButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  backButton: {
    width: '100%',
    backgroundColor: '#374151',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
