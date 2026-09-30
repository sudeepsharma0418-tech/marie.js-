import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button } from '../../components/ui';
import { StatusPill } from '../../components/StatusPill';
import { useAppStore, useDevice } from '../../state/AppStore';
import { CONNECTION_COPY } from '../../utils/connectionState';
import { radius, spacing, usePalette } from '../../theme';

/**
 * Controller side viewer. In Phase 5 the placeholder below becomes an
 * RTCView bound to the remote WebRTC video track. The state handling around
 * it is already final: every state gets a clear message, never an error code.
 */
export default function Session() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useDevice(id);
  const { actions } = useAppStore();

  if (!device) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: p.bg, padding: spacing.lg, gap: spacing.lg }]}>
        <Banner tone="danger">{CONNECTION_COPY.unauthorized.message} Ask the owner to pair again if needed.</Banner>
        <Button title="Back to My Devices" onPress={() => router.dismissAll()} />
      </SafeAreaView>
    );
  }

  const copy = CONNECTION_COPY[device.state];
  const live = device.state === 'connected';

  return (
    <SafeAreaView edges={['bottom']} style={[styles.fill, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ title: device.name }} />
      <View style={[styles.header, { backgroundColor: p.bg }]}>
        <StatusPill state={device.state} />
        <Text style={{ color: p.textMuted, flex: 1 }} numberOfLines={1}>
          {device.permissions.remoteControl ? 'View and control' : 'View only'}
        </Text>
      </View>

      <View style={styles.stage}>
        {live ? (
          <View style={[styles.phoneFrame, { borderColor: p.border }]}>
            <Text style={styles.placeholder}>Remote screen appears here</Text>
            <Text style={[styles.placeholder, { fontSize: 12, opacity: 0.6 }]}>(WebRTC video arrives in Phase 5)</Text>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            {device.state === 'connecting' || device.state === 'reconnecting' ? (
              <ActivityIndicator color="#FFFFFF" size="large" />
            ) : null}
            <Text style={styles.stateText}>{copy.message}</Text>
          </View>
        )}
      </View>

      <View style={[styles.footer, { backgroundColor: p.bg }]}>
        {live ? (
          <Button
            kind="secondary"
            title="Stop Connection"
            onPress={() => {
              actions.disconnect(device.id);
              router.back();
            }}
          />
        ) : device.state === 'offline' || device.state === 'disconnected' ? (
          <Button title="Try Again" onPress={() => actions.connect(device.id)} />
        ) : (
          <Button kind="secondary" title="Cancel" onPress={() => router.back()} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  phoneFrame: {
    aspectRatio: 9 / 19.5,
    height: '100%',
    maxWidth: '100%',
    borderWidth: 2,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15181E',
    gap: spacing.sm,
  },
  placeholder: { color: '#FFFFFF', textAlign: 'center' },
  stateText: { color: '#FFFFFF', fontSize: 17, textAlign: 'center' },
  footer: { padding: spacing.lg },
});
