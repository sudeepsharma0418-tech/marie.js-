import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ConnectionState } from '../types';
import { radius, spacing, usePalette } from '../theme';
import { CONNECTION_COPY } from '../utils/connectionState';

export function StatusPill({ state }: { state: ConnectionState }) {
  const p = usePalette();
  const copy = CONNECTION_COPY[state];
  const color = p[copy.dot];
  return (
    <View
      style={[styles.pill, { backgroundColor: p.surfaceAlt }]}
      accessibilityLabel={`Status: ${copy.label}`}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={{ color: p.text, fontSize: 12, fontWeight: '600' }}>{copy.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
