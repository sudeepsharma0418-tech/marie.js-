import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Banner, Body, Button, Card, Screen } from '../components/ui';
import { useAppStore } from '../state/AppStore';
import { buildPairingUri } from '../services/pairingPayload';
import { spacing, usePalette } from '../theme';
import { formatPairingCode } from '../utils/format';

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, Math.round((until - now) / 1000));
}

export default function Host() {
  const p = usePalette();
  const { state, actions } = useAppStore();
  const { host } = state;
  const [showQr, setShowQr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useCountdown(host.codeExpiresAt);
  const expired = secondsLeft === 0;

  async function newCode() {
    setError(null);
    setLoading(true);
    try {
      await actions.startHosting();
    } catch {
      setError('Could not reach the PeerView server. Check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (host.status === 'idle' && !host.activeSession) void newCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (host.status === 'sharing') {
    const viewer = state.devices.find((d) => d.id === host.activeSession?.deviceId);
    return (
      <Screen>
        <Card>
          <Text style={{ color: p.danger, fontWeight: '700', fontSize: 16 }}>● Screen Sharing Active</Text>
          <Body>{viewer?.name ?? 'A device'} can see your screen right now.</Body>
          <Body muted>
            Leave PeerView and use your phone normally. Apps that protect their content (banking, DRM video, secure
            password fields) stay hidden from the viewer. That is expected.
          </Body>
        </Card>
        <Button kind="danger" title="Stop Sharing" onPress={actions.stopSharing} />
      </Screen>
    );
  }

  const code = host.pairingCode;
  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ color: p.success, fontWeight: '600' }}>🟢 Ready</Text>
        <Body muted>Your pairing code</Body>
        <Text
          style={{ color: expired ? p.textMuted : p.text, fontSize: 44, fontWeight: '700', letterSpacing: 4 }}
          accessibilityLabel={code ? `Pairing code ${code.split('').join(' ')}` : 'Loading code'}
          selectable={false}
        >
          {code ? formatPairingCode(code) : '···-···'}
        </Text>
        {secondsLeft != null ? (
          <Body muted>
            {expired
              ? 'This code has expired.'
              : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
          </Body>
        ) : null}
        {showQr && code && host.pairingNonce && !expired ? (
          <View style={{ padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
            <QRCode value={buildPairingUri({ code, nonce: host.pairingNonce })} size={200} />
          </View>
        ) : null}
      </Card>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {expired ? (
        <Button title="Get New Code" onPress={newCode} loading={loading} />
      ) : (
        <Button
          kind="secondary"
          title={showQr ? 'Hide QR Code' : 'Show QR Code'}
          onPress={() => setShowQr((v) => !v)}
          disabled={!code}
        />
      )}

      <Body muted center>
        Waiting for a trusted device... You will be asked to approve every new device before it can see anything.
      </Body>

      {__DEV__ ? (
        <Button
          kind="ghost"
          title="Simulate incoming request (dev only)"
          onPress={actions.simulateIncomingRequest}
        />
      ) : null}
      <Button
        kind="ghost"
        title="Cancel"
        onPress={() => {
          actions.stopHosting();
          setShowQr(false);
        }}
      />
    </Screen>
  );
}
