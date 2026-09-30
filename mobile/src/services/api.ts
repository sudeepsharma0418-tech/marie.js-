import type {
  Account,
  ConnectionHistoryEntry,
  Permissions,
  TrustedDevice,
} from '../types';

/**
 * The contract between the app and the backend. Phase 1 ships a mock
 * implementation (mockApi.ts) with realistic data and latency. Phase 2 to 4
 * replace it with an HTTP + WebSocket client without touching any screen.
 */
export interface PeerViewApi {
  login(email: string, password: string): Promise<Account>;
  register(displayName: string, email: string, password: string): Promise<Account>;
  logout(): Promise<void>;

  listDevices(): Promise<TrustedDevice[]>;
  listHistory(): Promise<ConnectionHistoryEntry[]>;

  /** Host: ask the server for a fresh short lived pairing code. */
  createPairingCode(): Promise<{ code: string; nonce: string; expiresAt: number }>;
  /** Controller: submit a code (typed or scanned) to request access. */
  requestPairing(code: string, nonce?: string): Promise<{ requestId: string }>;
  /** Host: answer a pending request. */
  respondToPairing(
    requestId: string,
    decision: 'once' | 'trust' | 'deny',
    granted: Permissions,
  ): Promise<void>;

  renameDevice(deviceId: string, name: string): Promise<void>;
  setAutoConnect(deviceId: string, enabled: boolean): Promise<void>;
  /** Revokes trust server side; the device's credentials stop working at once. */
  revokeDevice(deviceId: string): Promise<void>;
}
