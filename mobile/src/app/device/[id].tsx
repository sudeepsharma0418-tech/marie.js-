import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Body, Button, Card, Divider, Field, Screen, ToggleRow } from '../../components/ui';
import { StatusPill } from '../../components/StatusPill';
import { useAppStore, useDevice } from '../../state/AppStore';
import { confirmSensitiveAction } from '../../services/biometrics';
import { useRemoveDevice } from '../../hooks/useRemoveDevice';
import { usePalette } from '../../theme';
import { relativeTime } from '../../utils/format';

function InfoRow({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: p.textMuted }}>{label}</Text>
      <Text style={{ color: p.text, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

export default function DeviceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useDevice(id);
  const { state, actions } = useAppStore();
  const remove = useRemoveDevice();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device?.name ?? '');

  if (!device) {
    return (
      <Screen>
        <Body>This device is no longer paired.</Body>
        <Button title="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  async function toggleAutoConnect(v: boolean) {
    // Turning automatic access ON is sensitive; turning it OFF never needs a check.
    if (v && !(await confirmSensitiveAction('Enable automatic connection', state.settings.biometricForSensitiveActions))) {
      return;
    }
    await actions.setAutoConnect(device!.id, v);
  }

  const isActive = device.state === 'connected' || device.state === 'connecting';

  return (
    <Screen>
      <Stack.Screen options={{ title: device.name }} />
      <Card>
        {editing ? (
          <>
            <Field label="Device name" value={name} onChangeText={setName} autoFocus maxLength={40} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                small
                title="Save"
                disabled={!name.trim()}
                onPress={async () => {
                  await actions.rename(device.id, name.trim());
                  setEditing(false);
                }}
              />
              <Button small kind="secondary" title="Cancel" onPress={() => setEditing(false)} />
            </View>
          </>
        ) : (
          <InfoRow label="Name" value={device.name} />
        )}
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Body muted>Status</Body>
          <StatusPill state={device.state} />
        </View>
        <InfoRow label="Device type" value={device.model} />
        <InfoRow label="Operating system" value={device.osVersion} />
        <InfoRow label="Last connected" value={relativeTime(device.lastConnectedAt)} />
        <InfoRow label="Trust" value={device.trust === 'trusted' ? 'Trusted' : 'This session only'} />
        <InfoRow
          label="Access"
          value={device.permissions.remoteControl ? 'View and control' : 'View only'}
        />
        <InfoRow
          label="Direction"
          value={device.role === 'host' ? 'You can view this phone' : 'This phone can view yours'}
        />
      </Card>

      <Card>
        <ToggleRow
          title="Automatically Connect"
          description="Automatically connect to this trusted device when it becomes available."
          value={device.autoConnect}
          onChange={toggleAutoConnect}
          disabled={device.trust !== 'trusted' || !state.settings.autoReconnect}
        />
        {!state.settings.autoReconnect ? (
          <Body muted>Automatic Reconnection is off in Settings.</Body>
        ) : null}
      </Card>

      {device.role === 'host' ? (
        isActive ? (
          <Button kind="secondary" title="Stop Connection" onPress={() => actions.disconnect(device.id)} />
        ) : (
          <Button
            title="Connect"
            onPress={() => {
              actions.connect(device.id);
              router.push(`/session/${device.id}`);
            }}
          />
        )
      ) : null}
      {!editing ? <Button kind="secondary" title="Rename" onPress={() => setEditing(true)} /> : null}
      <Button kind="danger" title="Remove Access" onPress={() => remove(device, () => router.back())} />
      <Body muted>
        Stop Connection only ends the current session. Remove Access permanently revokes this device; it would need a
        new code and your approval to come back.
      </Body>
    </Screen>
  );
}
