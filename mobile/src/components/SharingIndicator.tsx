import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../state/AppStore';
import { spacing, usePalette } from '../theme';

/**
 * Always on top banner while this phone's screen is being shared. It sits in
 * addition to (never instead of) the OS indicators: the Android status bar chip
 * and projection notification, and the iOS red status bar / Dynamic Island.
 * Stop Sharing ends the session but keeps a trusted device paired.
 */
export function SharingIndicator() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { state, actions } = useAppStore();
  const session = state.host.activeSession;
  if (!session) return null;
  const viewer = state.devices.find((d) => d.id === session.deviceId);

  return (
    <View
      style={[styles.bar, { backgroundColor: p.sharingBanner, paddingTop: insets.top + spacing.xs }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>● Screen Sharing Active</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {viewer ? `${viewer.name} can see your screen` : 'Another device can see your screen'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop Sharing"
        onPress={actions.stopSharing}
        style={({ pressed }) => [styles.stop, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={styles.stopText}>Stop Sharing</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  title: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  sub: { color: '#FFFFFFD0', fontSize: 12 },
  stop: { backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: 8 },
  stopText: { color: '#B32020', fontWeight: '700', fontSize: 14 },
});
