import * as SecureStore from 'expo-secure-store';

/**
 * Thin wrapper over expo-secure-store (iOS Keychain / Android Keystore backed).
 * Everything secret goes through here: device id, refresh tokens, and later the
 * device key handle. Nothing secret is ever written to AsyncStorage or logs.
 *
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY lets the app read credentials when it is
 * woken in the background after a reboot (once the user has unlocked once),
 * which automatic reconnection needs, and it keeps secrets out of backups so
 * a restored backup on another phone cannot impersonate this device.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const KEYS = {
  deviceId: 'peerview.deviceId',
  refreshToken: 'peerview.refreshToken',
} as const;

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, OPTIONS);
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS);
}
