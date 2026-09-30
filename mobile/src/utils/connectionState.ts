import type { ConnectionState } from '../types';
import type { Palette } from '../theme';

interface StateCopy {
  label: string;
  message: string;
  dot: keyof Palette;
}

/** One place that turns every connection state into friendly UI copy. */
export const CONNECTION_COPY: Record<ConnectionState, StateCopy> = {
  connecting: { label: 'Connecting', message: 'Connecting to device...', dot: 'warning' },
  connected: { label: 'Connected', message: 'Connected', dot: 'success' },
  reconnecting: {
    label: 'Reconnecting',
    message: 'Connection lost. Trying to reconnect...',
    dot: 'warning',
  },
  disconnected: { label: 'Disconnected', message: 'Device disconnected.', dot: 'offline' },
  offline: { label: 'Offline', message: 'Device is currently unavailable.', dot: 'offline' },
  pairing_required: {
    label: 'Pairing required',
    message: 'This device is not trusted.',
    dot: 'warning',
  },
  permission_required: {
    label: 'Waiting for approval',
    message: 'Host approval is required.',
    dot: 'warning',
  },
  unauthorized: { label: 'Access revoked', message: 'Access has been revoked.', dot: 'danger' },
};
