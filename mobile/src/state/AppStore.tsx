import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import type {
  Account,
  ConnectionHistoryEntry,
  HostShareState,
  PairingRequest,
  Permissions,
  Settings,
  TrustedDevice,
} from '../types';
import type { PeerViewApi } from '../services/api';
import { mockApi, simulateIncomingPairingRequest } from '../services/mockApi';
import { getOrCreateDeviceId } from '../services/deviceIdentity';

interface State {
  account: Account | null;
  deviceId: string | null;
  devices: TrustedDevice[];
  history: ConnectionHistoryEntry[];
  settings: Settings;
  host: HostShareState;
  pendingRequest: PairingRequest | null;
}

const DEFAULT_SETTINGS: Settings = {
  autoReconnect: true,
  biometricForSensitiveActions: true,
  notifyOnPairingRequest: true,
  notifyOnConnection: true,
  allowRemoteControlRequests: false,
  quality: 'auto',
  preferDirectConnection: true,
  allowCellular: true,
};

const INITIAL: State = {
  account: null,
  deviceId: null,
  devices: [],
  history: [],
  settings: DEFAULT_SETTINGS,
  host: { status: 'idle', pairingCode: null, pairingNonce: null, codeExpiresAt: null, activeSession: null },
  pendingRequest: null,
};

type Action =
  | { type: 'deviceId'; id: string }
  | { type: 'signedIn'; account: Account }
  | { type: 'signedOut' }
  | { type: 'loaded'; devices: TrustedDevice[]; history: ConnectionHistoryEntry[] }
  | { type: 'device'; id: string; patch: Partial<TrustedDevice> }
  | { type: 'deviceRemoved'; id: string }
  | { type: 'deviceAdded'; device: TrustedDevice }
  | { type: 'historyAdded'; entry: ConnectionHistoryEntry }
  | { type: 'historyEnded'; deviceId: string; reason: ConnectionHistoryEntry['endReason'] }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'host'; patch: Partial<HostShareState> }
  | { type: 'pendingRequest'; request: PairingRequest | null };

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'deviceId':
      return { ...state, deviceId: a.id };
    case 'signedIn':
      return { ...state, account: a.account };
    case 'signedOut':
      return { ...INITIAL, deviceId: state.deviceId, settings: state.settings };
    case 'loaded':
      return { ...state, devices: a.devices, history: a.history };
    case 'device':
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === a.id ? { ...d, ...a.patch } : d)),
      };
    case 'deviceRemoved':
      return { ...state, devices: state.devices.filter((d) => d.id !== a.id) };
    case 'deviceAdded':
      return { ...state, devices: [a.device, ...state.devices.filter((d) => d.id !== a.device.id)] };
    case 'historyAdded':
      return { ...state, history: [a.entry, ...state.history] };
    case 'historyEnded': {
      const t = Date.now();
      return {
        ...state,
        history: state.history.map((h) =>
          h.deviceId === a.deviceId && h.endedAt == null ? { ...h, endedAt: t, endReason: a.reason } : h,
        ),
      };
    }
    case 'settings':
      return { ...state, settings: { ...state.settings, ...a.patch } };
    case 'host':
      return { ...state, host: { ...state.host, ...a.patch } };
    case 'pendingRequest':
      return { ...state, pendingRequest: a.request };
  }
}

interface Actions {
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  requestPairing(code: string, nonce?: string): Promise<void>;
  startHosting(): Promise<void>;
  stopHosting(): void;
  simulateIncomingRequest(): void;
  respondToRequest(decision: 'once' | 'trust' | 'deny', granted: Permissions): Promise<void>;
  stopSharing(): void;
  connect(deviceId: string): void;
  disconnect(deviceId: string): void;
  rename(deviceId: string, name: string): Promise<void>;
  setAutoConnect(deviceId: string, enabled: boolean): Promise<void>;
  revoke(deviceId: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
}

const Ctx = createContext<{ state: State; actions: Actions } | null>(null);

export function AppStoreProvider({
  children,
  api = mockApi,
}: {
  children: React.ReactNode;
  api?: PeerViewApi;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    getOrCreateDeviceId()
      .then((id) => dispatch({ type: 'deviceId', id }))
      .catch(() => {
        // Secure storage unavailable (e.g. web preview). The app still works;
        // pairing will be blocked until an identity exists.
      });
  }, []);

  const refresh = useCallback(async () => {
    const [devices, history] = await Promise.all([api.listDevices(), api.listHistory()]);
    dispatch({ type: 'loaded', devices, history });
  }, [api]);

  const connect = useCallback((deviceId: string) => {
    // Phase 1 simulation of the real signaling flow: connecting, then connected.
    // Phase 4/5 replace this with presence lookup, session negotiation and WebRTC.
    dispatch({ type: 'device', id: deviceId, patch: { state: 'connecting' } });
    setTimeout(() => {
      dispatch({ type: 'device', id: deviceId, patch: { state: 'connected', lastConnectedAt: Date.now() } });
    }, 1500);
  }, []);

  const actions = useMemo<Actions>(
    () => ({
      async login(email, password) {
        const account = await api.login(email, password);
        dispatch({ type: 'signedIn', account });
        await refresh();
      },
      async register(name, email, password) {
        const account = await api.register(name, email, password);
        dispatch({ type: 'signedIn', account });
        await refresh();
      },
      async logout() {
        await api.logout();
        dispatch({ type: 'signedOut' });
      },
      refresh,
      async requestPairing(code, nonce) {
        await api.requestPairing(code, nonce);
      },
      async startHosting() {
        const { code, nonce, expiresAt } = await api.createPairingCode();
        dispatch({
          type: 'host',
          patch: { status: 'ready', pairingCode: code, pairingNonce: nonce, codeExpiresAt: expiresAt },
        });
      },
      stopHosting() {
        dispatch({
          type: 'host',
          patch: { status: 'idle', pairingCode: null, pairingNonce: null, codeExpiresAt: null },
        });
      },
      simulateIncomingRequest() {
        dispatch({ type: 'pendingRequest', request: simulateIncomingPairingRequest() });
      },
      async respondToRequest(decision, granted) {
        const req = state.pendingRequest;
        if (!req) return;
        await api.respondToPairing(req.id, decision, granted);
        dispatch({ type: 'pendingRequest', request: null });
        if (decision === 'deny') {
          dispatch({
            type: 'historyAdded',
            entry: {
              id: `h_${Date.now()}`,
              deviceId: req.device.id,
              deviceName: req.device.name,
              direction: 'incoming',
              startedAt: Date.now(),
              endedAt: Date.now(),
              endReason: 'denied',
            },
          });
          return;
        }
        const t = Date.now();
        dispatch({
          type: 'deviceAdded',
          device: {
            ...req.device,
            role: 'controller',
            trust: decision === 'trust' ? 'trusted' : 'once',
            permissions: granted,
            state: 'connected',
            lastConnectedAt: t,
            pairedAt: t,
            autoConnect: false,
          },
        });
        dispatch({
          type: 'historyAdded',
          entry: {
            id: `h_${t}`,
            deviceId: req.device.id,
            deviceName: req.device.name,
            direction: 'incoming',
            startedAt: t,
            endedAt: null,
          },
        });
        // The pairing code is single use: burn it as soon as it has been used.
        dispatch({
          type: 'host',
          patch: {
            status: 'sharing',
            pairingCode: null,
            pairingNonce: null,
            codeExpiresAt: null,
            activeSession: { deviceId: req.device.id, startedAt: t },
          },
        });
      },
      stopSharing() {
        const session = state.host.activeSession;
        if (session) {
          dispatch({ type: 'historyEnded', deviceId: session.deviceId, reason: 'stopped_by_host' });
          const dev = state.devices.find((d) => d.id === session.deviceId);
          // "Allow once" access ends with the session. Trusted devices stay paired.
          if (dev?.trust === 'once') dispatch({ type: 'deviceRemoved', id: dev.id });
          else dispatch({ type: 'device', id: session.deviceId, patch: { state: 'disconnected' } });
        }
        dispatch({ type: 'host', patch: { status: 'idle', activeSession: null } });
      },
      connect,
      disconnect(deviceId) {
        dispatch({ type: 'historyEnded', deviceId, reason: 'stopped_by_controller' });
        dispatch({ type: 'device', id: deviceId, patch: { state: 'disconnected' } });
      },
      async rename(deviceId, name) {
        await api.renameDevice(deviceId, name);
        dispatch({ type: 'device', id: deviceId, patch: { name } });
      },
      async setAutoConnect(deviceId, enabled) {
        await api.setAutoConnect(deviceId, enabled);
        dispatch({ type: 'device', id: deviceId, patch: { autoConnect: enabled } });
      },
      async revoke(deviceId) {
        await api.revokeDevice(deviceId);
        if (state.host.activeSession?.deviceId === deviceId) {
          dispatch({ type: 'host', patch: { status: 'idle', activeSession: null } });
        }
        dispatch({ type: 'historyEnded', deviceId, reason: 'revoked' });
        dispatch({ type: 'deviceRemoved', id: deviceId });
      },
      updateSettings(patch) {
        dispatch({ type: 'settings', patch });
      },
    }),
    [api, refresh, connect, state.pendingRequest, state.host.activeSession, state.devices],
  );

  return <Ctx.Provider value={{ state, actions }}>{children}</Ctx.Provider>;
}

export function useAppStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppStore must be used inside AppStoreProvider');
  return v;
}

export function useDevice(id: string | undefined) {
  const { state } = useAppStore();
  return state.devices.find((d) => d.id === id);
}
