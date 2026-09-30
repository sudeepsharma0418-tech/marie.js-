import * as Crypto from 'expo-crypto';
import type { ConnectionHistoryEntry, PairingRequest, TrustedDevice } from '../types';
import type { PeerViewApi } from './api';

/**
 * Mock backend for Phase 1. It keeps the same shapes and failure modes the
 * real server will have, so screens are built against realistic behavior
 * (latency, expiring codes, wrong codes) instead of happy path stubs.
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let devices: TrustedDevice[] = [
  {
    id: 'dev_iphone_15',
    name: "Sudeep's iPhone",
    platform: 'ios',
    model: 'iPhone 15',
    osVersion: 'iOS 26.0',
    role: 'host',
    trust: 'trusted',
    permissions: { viewScreen: true, remoteControl: false },
    state: 'connected',
    lastConnectedAt: now - 20_000,
    pairedAt: now - 40 * DAY,
    autoConnect: true,
  },
  {
    id: 'dev_pixel_8',
    name: 'My Android Phone',
    platform: 'android',
    model: 'Pixel 8',
    osVersion: 'Android 16',
    role: 'host',
    trust: 'trusted',
    permissions: { viewScreen: true, remoteControl: true },
    state: 'offline',
    lastConnectedAt: now - DAY - 3 * HOUR,
    pairedAt: now - 12 * DAY,
    autoConnect: true,
  },
  {
    id: 'dev_galaxy_s24',
    name: "Mom's Galaxy",
    platform: 'android',
    model: 'Galaxy S24',
    osVersion: 'Android 15',
    role: 'controller',
    trust: 'trusted',
    permissions: { viewScreen: true, remoteControl: false },
    state: 'offline',
    lastConnectedAt: now - 5 * DAY,
    pairedAt: now - 30 * DAY,
    autoConnect: false,
  },
];

let history: ConnectionHistoryEntry[] = [
  {
    id: 'h1',
    deviceId: 'dev_iphone_15',
    deviceName: "Sudeep's iPhone",
    direction: 'outgoing',
    startedAt: now - 17 * MIN,
    endedAt: null,
  },
  {
    id: 'h2',
    deviceId: 'dev_pixel_8',
    deviceName: 'My Android Phone',
    direction: 'outgoing',
    startedAt: now - DAY - 3 * HOUR - 32 * MIN,
    endedAt: now - DAY - 3 * HOUR,
    endReason: 'stopped_by_controller',
  },
  {
    id: 'h3',
    deviceId: 'dev_galaxy_s24',
    deviceName: "Mom's Galaxy",
    direction: 'incoming',
    startedAt: now - 5 * DAY - 45 * MIN,
    endedAt: now - 5 * DAY,
    endReason: 'stopped_by_host',
  },
  {
    id: 'h4',
    deviceId: 'dev_unknown',
    deviceName: 'Unknown Android',
    direction: 'incoming',
    startedAt: now - 6 * DAY,
    endedAt: now - 6 * DAY,
    endReason: 'denied',
  },
];

let activeCode: { code: string; nonce: string; expiresAt: number } | null = null;

/** Uniform random digits (rejection sampling avoids modulo bias). */
function randomDigits(n: number): string {
  let out = '';
  while (out.length < n) {
    for (const b of Crypto.getRandomBytes(n)) {
      if (b < 250 && out.length < n) out += (b % 10).toString();
    }
  }
  return out;
}

function randomToken(bytes: number): string {
  return Array.from(Crypto.getRandomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const mockApi: PeerViewApi = {
  async login(email, password) {
    await wait(700);
    if (!email.includes('@') || password.length < 8) {
      throw new Error('That email and password combination did not work. Please try again.');
    }
    return { id: 'usr_1', email, displayName: email.split('@')[0] };
  },

  async register(displayName, email, password) {
    await wait(900);
    if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
    return { id: 'usr_1', email, displayName };
  },

  async logout() {
    await wait(200);
  },

  async listDevices() {
    await wait(300);
    return devices.map((d) => ({ ...d }));
  },

  async listHistory() {
    await wait(300);
    return [...history].sort((a, b) => b.startedAt - a.startedAt);
  },

  async createPairingCode() {
    await wait(400);
    activeCode = { code: randomDigits(6), nonce: randomToken(16), expiresAt: Date.now() + 5 * MIN };
    return activeCode;
  },

  async requestPairing(code) {
    await wait(800);
    // Demo rule so the flow can be tried on one phone: any code starting with 0 fails.
    if (code.startsWith('0')) {
      throw new Error('That code is not valid or has expired. Ask the other phone for a new code.');
    }
    return { requestId: `req_${randomToken(6)}` };
  },

  async respondToPairing() {
    await wait(300);
  },

  async renameDevice(id, name) {
    await wait(250);
    devices = devices.map((d) => (d.id === id ? { ...d, name } : d));
    history = history.map((h) => (h.deviceId === id ? { ...h, deviceName: name } : h));
  },

  async setAutoConnect(id, enabled) {
    await wait(200);
    devices = devices.map((d) => (d.id === id ? { ...d, autoConnect: enabled } : d));
  },

  async revokeDevice(id) {
    await wait(400);
    devices = devices.filter((d) => d.id !== id);
  },
};

/** Builds a fake incoming request so the Host approval screen can be exercised. */
export function simulateIncomingPairingRequest(): PairingRequest {
  return {
    id: `req_${randomToken(6)}`,
    device: {
      id: `dev_${randomToken(4)}`,
      name: "John's Phone",
      platform: 'android',
      model: 'Galaxy A55',
      osVersion: 'Android 15',
    },
    requested: { viewScreen: true, remoteControl: true },
    networkHint: 'Different network, Wi-Fi',
    receivedAt: Date.now(),
  };
}
