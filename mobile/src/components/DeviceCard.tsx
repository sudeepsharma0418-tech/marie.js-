import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { TrustedDevice } from '../types';
import { spacing, usePalette } from '../theme';
import { relativeTime } from '../utils/format';
import { Button, Card } from './ui';
import { StatusPill } from './StatusPill';

export function DeviceCard({
  device,
  onConnect,
}: {
  device: TrustedDevice;
  onConnect: (id: string) => void;
}) {
  const p = usePalette();
  const canView = device.role === 'host';
  const connected = device.state === 'connected';
  const busy = device.state === 'connecting' || device.state === 'reconnecting';

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.icon} accessibilityElementsHidden>
          📱
        </Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: p.text }]} numberOfLines={1}>
            {device.name}
          </Text>
          <Text style={{ color: p.textMuted, fontSize: 13 }}>
            {canView ? 'You can view this phone' : 'This phone can view yours'} · {relativeTime(device.lastConnectedAt)}
          </Text>
        </View>
        <StatusPill state={device.state} />
      </View>
      <View style={styles.actions}>
        {canView ? (
          connected ? (
            <Button small title="View Screen" onPress={() => router.push(`/session/${device.id}`)} />
          ) : (
            <Button
              small
              title={busy ? 'Connecting...' : 'Connect'}
              loading={busy}
              onPress={() => {
                onConnect(device.id);
                router.push(`/session/${device.id}`);
              }}
            />
          )
        ) : null}
        <Button small kind="secondary" title="Details" onPress={() => router.push(`/device/${device.id}`)} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { fontSize: 28 },
  name: { fontSize: 17, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
