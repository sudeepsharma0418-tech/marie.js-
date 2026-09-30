import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStoreProvider, useAppStore } from '../state/AppStore';
import { SharingIndicator } from '../components/SharingIndicator';
import { usePalette } from '../theme';

function RootNavigator() {
  const p = usePalette();
  const { state } = useAppStore();
  const signedIn = state.account != null;

  // A pairing request always interrupts whatever the Host is doing: nothing
  // connects until they explicitly answer it.
  useEffect(() => {
    if (state.pendingRequest) router.push('/pairing-request');
  }, [state.pendingRequest]);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <SharingIndicator />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: p.bg },
          headerTintColor: p.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: p.bg },
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ title: 'Create account' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ title: 'My Devices' }} />
          <Stack.Screen name="add-device" options={{ title: 'Add Device' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan QR Code', presentation: 'modal' }} />
          <Stack.Screen name="host" options={{ title: 'Share My Screen' }} />
          <Stack.Screen
            name="pairing-request"
            options={{ title: 'Remote Access Request', presentation: 'modal', gestureEnabled: false }}
          />
          <Stack.Screen name="trusted-devices" options={{ title: 'Trusted Devices' }} />
          <Stack.Screen name="device/[id]" options={{ title: 'Device' }} />
          <Stack.Screen name="session/[id]" options={{ title: 'Remote Screen' }} />
          <Stack.Screen name="history" options={{ title: 'Connection History' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppStoreProvider>
        <StatusBar style="auto" />
        <RootNavigator />
      </AppStoreProvider>
    </SafeAreaProvider>
  );
}
