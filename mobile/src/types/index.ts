export type Platform = 'ios' | 'android';

/**
 * Every state a connection to another device can be in. The UI maps each one
 * to a human readable message (see utils/connectionState.ts) so the user never
 * sees raw error codes.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'offline'
  | 'pairing_required'
  | 'permission_required'
  | 'unauthorized';

export interface Permissions {
  viewScreen: boolean;
  /** Only granted when the Host explicitly ticks it. Unsupported on iOS hosts. */
  remoteControl: boolean;
}

export type TrustLevel = 'trusted' | 'once' | 'revoked';

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  model: string;
  osVersion: string;
}

/**
 * A relationship between this phone and another phone. `role` is from this
 * phone's point of view: 'host' means *they* can view *my* screen.
 */
export interface TrustedDevice extends Device {
  role: 'host' | 'controller';
  trust: TrustLevel;
  permissions: Permissions;
  state: ConnectionState;
  lastConnectedAt: number | null;
  pairedAt: number;
  autoConnect: boolean;
}

export interface ConnectionHistoryEntry {
  id: string;
  deviceId: string;
  deviceName: string;
  direction: 'incoming' | 'outgoing';
  startedAt: number;
  endedAt: number | null;
  endReason?: 'stopped_by_host' | 'stopped_by_controller' | 'network_lost' | 'revoked' | 'denied';
}

export interface PairingRequest {
  id: string;
  device: Device;
  requested: Permissions;
  /** Coarse network hint shown to the Host, never a precise location. */
  networkHint: string;
  receivedAt: number;
}

export type StreamQuality = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  autoReconnect: boolean;
  biometricForSensitiveActions: boolean;
  notifyOnPairingRequest: boolean;
  notifyOnConnection: boolean;
  allowRemoteControlRequests: boolean;
  quality: StreamQuality;
  preferDirectConnection: boolean;
  allowCellular: boolean;
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
}

export interface HostShareState {
  status: 'idle' | 'ready' | 'sharing';
  pairingCode: string | null;
  pairingNonce: string | null;
  codeExpiresAt: number | null;
  activeSession: { deviceId: string; startedAt: number } | null;
}
