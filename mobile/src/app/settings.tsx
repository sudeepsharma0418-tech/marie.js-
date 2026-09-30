import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Body, Button, Card, Divider, NavRow, Screen, SectionHeader, ToggleRow } from '../components/ui';
import { useAppStore } from '../state/AppStore';
import { confirmSensitiveAction } from '../services/biometrics';
import type { StreamQuality } from '../types';
import { radius, spacing, usePalette } from '../theme';

const QUALITY: { key: StreamQuality; label: string; hint: string }[] = [
  { key: 'auto', label: 'Automatic', hint: 'Adjusts to your network' },
  { key: 'low', label: 'Low', hint: 'Lower bandwidth' },
  { key: 'medium', label: 'Medium', hint: 'Balanced' },
  { key: 'high', label: 'High', hint: 'Higher quality' },
];

export default function SettingsScreen() {
  const p = usePalette();
  const { state, actions } = useAppStore();
  const s = state.settings;
  const set = actions.updateSettings;

  async function guarded(reason: string, patch: Parameters<typeof set>[0]) {
    if (await confirmSensitiveAction(reason, s.biometricForSensitiveActions)) set(patch);
  }

  return (
    <Screen>
      <SectionHeader>Account</SectionHeader>
      <Card>
        <Body>{state.account?.displayName}</Body>
        <Body muted>{state.account?.email}</Body>
      </Card>

      <SectionHeader>Devices</SectionHeader>
      <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
        <NavRow title="Trusted Devices" onPress={() => router.push('/trusted-devices')} />
        <Divider />
        <NavRow title="Connection History" onPress={() => router.push('/history')} />
      </Card>

      <SectionHeader>Connections</SectionHeader>
      <Card>
        <ToggleRow
          title="Automatic Reconnection"
          description="Automatically reconnect to trusted devices when they become available."
          value={s.autoReconnect}
          onChange={(v) => (v ? guarded('Enable automatic reconnection', { autoReconnect: v }) : set({ autoReconnect: v }))}
        />
        <Body muted>Choose which devices connect automatically on each device's page.</Body>
      </Card>

      <SectionHeader>Screen Sharing</SectionHeader>
      <Card>
        <Text style={{ color: p.text, fontWeight: '500', fontSize: 16 }}>Quality</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {QUALITY.map((q) => {
            const selected = s.quality === q.key;
            return (
              <Pressable
                key={q.key}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => set({ quality: q.key })}
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: selected ? p.primary : p.border,
                  backgroundColor: selected ? p.primary : 'transparent',
                  minWidth: '45%',
                  flexGrow: 1,
                }}
              >
                <Text style={{ color: selected ? p.primaryText : p.text, fontWeight: '600' }}>{q.label}</Text>
                <Text style={{ color: selected ? p.primaryText : p.textMuted, fontSize: 12 }}>{q.hint}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionHeader>Remote Control</SectionHeader>
      <Card>
        <ToggleRow
          title="Allow remote control requests"
          description="Other devices may ask to control this phone. You still approve each device separately. Android only."
          value={s.allowRemoteControlRequests}
          onChange={(v) =>
            v ? guarded('Enable remote control', { allowRemoteControlRequests: v }) : set({ allowRemoteControlRequests: v })
          }
        />
      </Card>

      <SectionHeader>Network</SectionHeader>
      <Card>
        <ToggleRow
          title="Prefer direct connection"
          description="Connect phone to phone when possible, using a relay only when needed. Streams are encrypted either way."
          value={s.preferDirectConnection}
          onChange={(v) => set({ preferDirectConnection: v })}
        />
        <ToggleRow
          title="Use cellular data"
          description="Allow sharing and viewing over mobile data."
          value={s.allowCellular}
          onChange={(v) => set({ allowCellular: v })}
        />
      </Card>

      <SectionHeader>Notifications</SectionHeader>
      <Card>
        <ToggleRow
          title="New device requests"
          description="Always recommended. Alerts you when an unknown device asks for access."
          value={s.notifyOnPairingRequest}
          onChange={(v) => set({ notifyOnPairingRequest: v })}
        />
        <ToggleRow
          title="Connection alerts"
          description="Notify when a trusted device connects to this phone."
          value={s.notifyOnConnection}
          onChange={(v) => set({ notifyOnConnection: v })}
        />
      </Card>

      <SectionHeader>Security</SectionHeader>
      <Card>
        <ToggleRow
          title="Biometric Authentication"
          description="Require Face ID, fingerprint or passcode to trust or remove devices and enable automatic or remote access."
          value={s.biometricForSensitiveActions}
          onChange={(v) =>
            // Turning protection OFF is itself sensitive, so it must be confirmed.
            v ? set({ biometricForSensitiveActions: v }) : guarded('Turn off biometric protection', { biometricForSensitiveActions: v })
          }
        />
      </Card>

      <SectionHeader>Privacy</SectionHeader>
      <Card>
        <Body muted>
          Your screen is streamed only during a session you approved, and it is never recorded or stored. Streams are
          end to end encrypted between the two phones (DTLS SRTP). Apps that protect their content, like banking apps
          and secure password fields, stay hidden, and PeerView never tries to get around that.
        </Body>
      </Card>

      <Button kind="danger" title="Sign Out" onPress={actions.logout} />
    </Screen>
  );
}
