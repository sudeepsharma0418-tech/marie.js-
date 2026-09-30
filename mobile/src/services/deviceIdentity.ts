import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { KEYS, getSecret, setSecret } from './secureStorage';

/**
 * Stable per install device id, stored in secure storage.
 *
 * Phase 1 only needs the id. In Phase 2 this module also creates a
 * non exportable P-256 key pair in the Android Keystore / iOS Secure Enclave
 * through a small native module; the private key never leaves the hardware and
 * is used to sign login challenges and WebRTC DTLS fingerprints.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getSecret(KEYS.deviceId);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await setSecret(KEYS.deviceId, id);
  return id;
}

export function currentPlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
