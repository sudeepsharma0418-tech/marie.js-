import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Body, Button, Card, Divider, Screen, ToggleRow } from '../components/ui';
import { useAppStore } from '../state/AppStore';
import { confirmSensitiveAction } from '../services/biometrics';
import { currentPlatform } from '../services/deviceIdentity';
import { spacing, usePalette } from '../theme';

/**
 * Host side consent screen. Nothing is shared until one of the three buttons
 * is pressed, and remote control is off unless the Host ticks it.
 */
export default function PairingRequest() {
  const p = usePalette();
  const { state, actions } = useAppStore();
  const req = state.pendingRequest;
  const [allowControl, setAllowControl] = useState(false);
  const [busy, setBusy] = useState<null | 'once' | 'trust' | 'deny'>(null);

  // Remote control of *this* phone is only possible on Android (through an
  // Accessibility Service the user enables). iOS offers no public API for it.
  const controlSupported = currentPlatform() === 'android';

  if (!req) {
    return (
      <Screen>
        <Body>This request is no longer active.</Body>
        <Button title="Close" onPress={() => router.back()} />
      </Screen>
    );
  }

  async function answer(decision: 'once' | 'trust' | 'deny') {
    if (decision !== 'deny') {
      const reason = decision === 'trust' ? `Trust ${req!.device.name}` : `Allow ${req!.device.name}`;
      const ok = await confirmSensitiveAction(reason, state.settings.biometricForSensitiveActions);
      if (!ok) return;
    }
    setBusy(decision);
    try {
      await actions.respondToRequest(decision, {
        viewScreen: true,
        remoteControl: decision !== 'deny' && allowControl && controlSupported,
      });
      router.back();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Banner tone="warning">An unknown device wants to access your screen. Only approve it if you know who it is.</Banner>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Text style={{ fontSize: 32 }}>📱</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: p.text, fontSize: 18, fontWeight: '700' }}>{req.device.name}</Text>
            <Body muted>
              {req.device.model} · {req.device.osVersion}
            </Body>
            <Body muted>{req.networkHint}</Body>
          </View>
        </View>
        <Divider />
        <Text style={{ color: p.textMuted, fontWeight: '600' }}>Requested permissions</Text>
        <Body>✓ View my screen</Body>
        <ToggleRow
          title="Remote control"
          description={
            controlSupported
              ? 'Let them tap and type on this phone. You can turn this off at any time.'
              : 'Not available on iPhone. iOS does not allow other apps to control your phone.'
          }
          value={allowControl}
          onChange={setAllowControl}
          disabled={!controlSupported || !req.requested.remoteControl}
        />
      </Card>
      <Button title="Allow Once" onPress={() => answer('once')} loading={busy === 'once'} disabled={!!busy} />
      <Button
        kind="secondary"
        title="Trust This Device"
        onPress={() => answer('trust')}
        loading={busy === 'trust'}
        disabled={!!busy}
        accessibilityHint="Lets this device reconnect later without a new code, until you remove it"
      />
      <Button kind="danger" title="Deny" onPress={() => answer('deny')} loading={busy === 'deny'} disabled={!!busy} />
      <Body muted center>
        Your phone will also show its own screen recording prompt before sharing starts.
      </Body>
    </Screen>
  );
}
