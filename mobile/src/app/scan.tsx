import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Banner, Body, Button, Screen } from '../components/ui';
import { parsePairingUri } from '../services/pairingPayload';
import { radius, spacing } from '../theme';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  if (!permission) return <Screen>{null}</Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Body>PeerView needs the camera only to scan the pairing QR code. Nothing is recorded or uploaded.</Body>
        {permission.canAskAgain ? (
          <Button title="Allow Camera" onPress={requestPermission} />
        ) : (
          <Banner tone="warning">
            Camera access is turned off for PeerView. You can enable it in system Settings, or type the code instead.
          </Banner>
        )}
        <Button kind="secondary" title="Enter Code Instead" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const payload = parsePairingUri(data);
          if (!payload) {
            setError('That QR code is not a PeerView pairing code.');
            return;
          }
          handled.current = true;
          router.dismissTo({ pathname: '/add-device', params: { code: payload.code, nonce: payload.nonce ?? '' } });
        }}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Point at the QR code on the other phone</Text>
      </View>
      {error ? (
        <View style={styles.error}>
          <Banner tone="warning">{error}</Banner>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: radius.lg },
  hint: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  error: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxl },
});
