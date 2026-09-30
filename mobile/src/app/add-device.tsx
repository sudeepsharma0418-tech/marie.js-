import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Banner, Body, Button, Card, Field, Screen } from '../components/ui';
import { StatusPill } from '../components/StatusPill';
import { useAppStore } from '../state/AppStore';
import { spacing, usePalette } from '../theme';
import { formatPairingCode, normalizePairingCode } from '../utils/format';

type Phase = 'entry' | 'sending' | 'waiting';

export default function AddDevice() {
  const p = usePalette();
  const { actions } = useAppStore();
  const params = useLocalSearchParams<{ code?: string; nonce?: string }>();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('entry');
  const [error, setError] = useState<string | null>(null);

  async function submit(rawCode: string, nonce?: string) {
    const digits = normalizePairingCode(rawCode);
    if (digits.length !== 6) {
      setError('Pairing codes have 6 digits, like 839-421.');
      return;
    }
    setError(null);
    setPhase('sending');
    try {
      await actions.requestPairing(digits, nonce);
      setPhase('waiting');
    } catch (e) {
      setPhase('entry');
      setError(e instanceof Error ? e.message : 'Could not reach the other phone. Check your connection.');
    }
  }

  // Arriving from the QR scanner: submit straight away.
  useEffect(() => {
    if (params.code) {
      setCode(formatPairingCode(params.code));
      void submit(params.code, params.nonce);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, params.nonce]);

  if (phase === 'waiting') {
    return (
      <Screen>
        <Card style={{ alignItems: 'center' }}>
          <StatusPill state="permission_required" />
          <Text style={{ color: p.text, fontSize: 20, fontWeight: '600', textAlign: 'center' }}>
            Waiting for the other phone to approve
          </Text>
          <Body muted center>
            Ask the owner to tap Allow Once or Trust This Device. Nothing is shared until they do.
          </Body>
        </Card>
        <Button kind="secondary" title="Cancel Request" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Button title="Scan QR Code" onPress={() => router.push('/scan')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
        <Text style={{ color: p.textMuted }}>OR</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field
        label="Enter Access Code"
        value={code}
        onChangeText={(t) => setCode(formatPairingCode(normalizePairingCode(t)))}
        keyboardType="number-pad"
        placeholder="839-421"
        maxLength={7}
        autoComplete="off"
        textContentType="oneTimeCode"
        style={{ fontSize: 28, letterSpacing: 4, textAlign: 'center' }}
      />
      <Button
        title="Connect"
        onPress={() => submit(code)}
        loading={phase === 'sending'}
        disabled={normalizePairingCode(code).length !== 6}
      />
      <Body muted>
        Open PeerView on the other phone, tap Share My Screen, and enter the code it shows. The code works once and
        expires after 5 minutes.
      </Body>
    </Screen>
  );
}
