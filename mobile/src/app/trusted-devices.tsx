import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Body, Button, Card, Screen, SectionHeader } from '../components/ui';
import { StatusPill } from '../components/StatusPill';
import { useAppStore } from '../state/AppStore';
import { useRemoveDevice } from '../hooks/useRemoveDevice';
import type { TrustedDevice } from '../types';
import { spacing, usePalette } from '../theme';
import { relativeTime } from '../utils/format';

function Row({ d }: { d: TrustedDevice }) {
  const p = usePalette();
  const { actions } = useAppStore();
  const remove = useRemoveDevice();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text style={{ fontSize: 26 }}>📱</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: p.text, fontSize: 17, fontWeight: '600' }}>{d.name}</Text>
          <Body muted>Last connected: {relativeTime(d.lastConnectedAt)}</Body>
        </View>
        <StatusPill state={d.state} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {d.role === 'host' && d.state !== 'connected' ? (
          <Button
            small
            title="Connect"
            onPress={() => {
              actions.connect(d.id);
              router.push(`/session/${d.id}`);
            }}
          />
        ) : null}
        <Button small kind="secondary" title="Details" onPress={() => router.push(`/device/${d.id}`)} />
        <Button small kind="ghost" title="Remove Access" onPress={() => remove(d)} />
      </View>
    </Card>
  );
}

export default function TrustedDevices() {
  const { state } = useAppStore();
  const canView = state.devices.filter((d) => d.role === 'host');
  const canSeeMe = state.devices.filter((d) => d.role === 'controller');
  return (
    <Screen>
      <SectionHeader>Phones you can view</SectionHeader>
      {canView.length ? canView.map((d) => <Row key={d.id} d={d} />) : <Body muted>None yet.</Body>}
      <SectionHeader>Phones that can view you</SectionHeader>
      {canSeeMe.length ? (
        canSeeMe.map((d) => <Row key={d.id} d={d} />)
      ) : (
        <Body muted>No one can view your screen.</Body>
      )}
    </Screen>
  );
}
