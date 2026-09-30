import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeviceCard } from '../components/DeviceCard';
import { Body, Button, Card, NavRow, Divider, SectionHeader } from '../components/ui';
import { useAppStore } from '../state/AppStore';
import { spacing, usePalette } from '../theme';

export default function Home() {
  const p = usePalette();
  const { state, actions } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await actions.refresh();
    } finally {
      setRefreshing(false);
    }
  }, [actions]);

  const viewable = state.devices.filter((d) => d.role === 'host');

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView
        contentContainerStyle={styles.pad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.quick}>
          <View style={{ flex: 1 }}>
            <Button title="Share My Screen" onPress={() => router.push('/host')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button kind="secondary" title="+ Add Device" onPress={() => router.push('/add-device')} />
          </View>
        </View>

        <SectionHeader>Phones you can view</SectionHeader>
        {viewable.length === 0 ? (
          <Card>
            <Body muted>
              No devices yet. Tap Add Device and enter the code shown on the other phone.
            </Body>
          </Card>
        ) : (
          viewable.map((d) => <DeviceCard key={d.id} device={d} onConnect={actions.connect} />)
        )}

        <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
          <NavRow
            title="Trusted Devices"
            detail={String(state.devices.length)}
            onPress={() => router.push('/trusted-devices')}
          />
          <Divider />
          <NavRow title="Connection History" onPress={() => router.push('/history')} />
          <Divider />
          <NavRow title="Settings" onPress={() => router.push('/settings')} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.lg },
  quick: { flexDirection: 'row', gap: spacing.md },
});
