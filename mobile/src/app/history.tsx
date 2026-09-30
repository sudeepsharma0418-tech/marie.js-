import React from 'react';
import { Text, View } from 'react-native';
import { Body, Card, Divider, Screen, SectionHeader } from '../components/ui';
import { useAppStore } from '../state/AppStore';
import type { ConnectionHistoryEntry } from '../types';
import { spacing, usePalette } from '../theme';
import { clockTime, dayLabel, duration } from '../utils/format';

function describe(e: ConnectionHistoryEntry): string {
  if (e.endReason === 'denied') return `Denied access request from ${e.deviceName}`;
  return e.direction === 'outgoing' ? `Viewed ${e.deviceName}` : `${e.deviceName} viewed your screen`;
}

function detail(e: ConnectionHistoryEntry): string {
  if (e.endReason === 'denied') return 'No session was started';
  if (e.endedAt == null) return 'In progress';
  const reason =
    e.endReason === 'revoked'
      ? ' · access removed'
      : e.endReason === 'network_lost'
        ? ' · connection lost'
        : '';
  return `Duration: ${duration(e.startedAt, e.endedAt)}${reason}`;
}

export default function History() {
  const p = usePalette();
  const { state } = useAppStore();

  const groups = new Map<string, ConnectionHistoryEntry[]>();
  for (const e of state.history) {
    const key = dayLabel(e.startedAt);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <Screen>
      <Body muted>Every connection to or from this phone. If you see one you do not recognize, remove that device.</Body>
      {state.history.length === 0 ? <Body muted>No connections yet.</Body> : null}
      {[...groups.entries()].map(([day, entries]) => (
        <View key={day} style={{ gap: spacing.sm }}>
          <SectionHeader>{day}</SectionHeader>
          <Card style={{ gap: spacing.sm }}>
            {entries.map((e, i) => (
              <View key={e.id} style={{ gap: 2 }}>
                {i > 0 ? <Divider /> : null}
                <Text style={{ color: p.textMuted, fontSize: 13, marginTop: i > 0 ? spacing.sm : 0 }}>
                  {clockTime(e.startedAt)}
                </Text>
                <Text
                  style={{ color: e.endReason === 'denied' ? p.warning : p.text, fontSize: 16, fontWeight: '500' }}
                >
                  {describe(e)}
                </Text>
                <Text style={{ color: p.textMuted, fontSize: 13 }}>{detail(e)}</Text>
              </View>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
