/**
 * GLBViewer — Production-ready 3D GLB animation renderer
 *
 * Uses a WebView with full WebGL 2.0 support to render
 * animated GLB models (SkinnedMesh, Skeleton, PBR materials).
 *
 * expo-gl only provides WebGL 1.0 which cannot render
 * SkinnedMesh bone textures (FloatType DataTexture).
 * A WebView gives us a real browser context with full
 * WebGL 2.0 — guaranteed to work on iOS and Android.
 */
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';

/** Convert ArrayBuffer to base64 string (no external deps) */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

// HTML source for the 3D viewer
const VIEWER_HTML = require('../assets/glb-viewer.html');

interface GLBViewerProps {
  /** require() id from MODEL_MAP */
  modelModule: number;
  /** Whether animation is playing */
  isPlaying: boolean;
  /** Called when model is loaded */
  onLoaded?: () => void;
  /** Called on load error */
  onError?: (message: string) => void;
  /** Called with debug info about the model */
  onDebugInfo?: (info: any) => void;
  /** Background color (CSS) */
  backgroundColor?: string;
}

export default function GLBViewer({
  modelModule,
  isPlaying,
  onLoaded,
  onError,
  onDebugInfo,
  backgroundColor = '#060D09',
}: GLBViewerProps) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [viewerReady, setViewerReady] = useState(false);
  const modelSentRef = useRef(false);

  // ── Load and send model to WebView ──
  const sendModel = useCallback(async () => {
    if (!viewerReady || modelSentRef.current) return;
    try {
      const asset = Asset.fromModule(modelModule);
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      if (!uri) throw new Error('Cannot resolve GLB asset URI');

      // Read file as ArrayBuffer and convert to base64 data URI
      const response = await fetch(uri);
      const buffer = await response.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const dataUri = `data:model/gltf-binary;base64,${base64}`;

      // Use injectJavaScript to set data on window, then call loadModel
      // Split into two steps to handle large payloads:
      // 1. Store data URI in a global variable
      // 2. Call loadModel with that variable
      const escaped = dataUri.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const js = `
        window.__pendingModelData = '${escaped}';
        if (window.loadModel) {
          window.loadModel(window.__pendingModelData);
          delete window.__pendingModelData;
        }
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
      modelSentRef.current = true;
    } catch (err: any) {
      console.error('[GLBViewer] Asset load error:', err);
      setLoading(false);
      onError?.(err?.message || 'Failed to load GLB asset');
    }
  }, [viewerReady, modelModule, onError]);

  useEffect(() => {
    if (viewerReady) sendModel();
  }, [viewerReady, sendModel]);

  // ── Sync play/pause state ──
  useEffect(() => {
    if (!viewerReady || !modelSentRef.current) return;
    const fn = isPlaying ? 'resume' : 'pause';
    webViewRef.current?.injectJavaScript(`try{window.${fn}()}catch(e){};true;`);
  }, [isPlaying, viewerReady]);

  // ── Handle messages from WebView ──
  const onMessage = useCallback(
    (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        switch (msg.type) {
          case 'ready':
            setViewerReady(true);
            break;
          case 'loaded':
            setLoading(false);
            onLoaded?.();
            break;
          case 'error':
            setLoading(false);
            onError?.(msg.message);
            break;
          case 'debug':
            console.log('[GLBViewer] Model info:', JSON.stringify(msg.data));
            onDebugInfo?.(msg.data);
            break;
          case 'animationStarted':
            console.log(
              `[GLBViewer] ▶ Animation: "${msg.name}" (${msg.duration?.toFixed(2)}s)`
            );
            break;
        }
      } catch (e) {
        // ignore parse errors
      }
    },
    [onLoaded, onError, onDebugInfo]
  );

  return (
    <View style={{ flex: 1, backgroundColor }}>
      <WebView
        ref={webViewRef}
        source={VIEWER_HTML}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        onMessage={onMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        startInLoadingState={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
