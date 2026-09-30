# PeerView: Architecture and Plan

PeerView is a permission based, phone to phone screen sharing and remote assistance app. One phone (the **Host**) shares its screen; another phone (the **Controller**) views it, and on Android may control it if the Host grants that separately.

> **About platform facts in this document.** The official Android and Apple docs could not be fetched from the build sandbox where this was written. The platform capabilities and limits below reflect current Android (14, 15, 16) and iOS (17 to 26) behavior as best known, and each one marked **[verify]** must be checked against developer.android.com and developer.apple.com before the phase that depends on it. No API is used in code until it has been checked.

---

## 1. Overall architecture

```
 Controller phone                                    Host phone
 ┌──────────────────┐                               ┌──────────────────────────┐
 │ React Native UI   │                               │ React Native UI           │
 │ RTCView (video)   │                               │ Capture module            │
 │ Input sender      │                               │  Android: MediaProjection │
 └──────┬───────┬────┘                               │  iOS: ReplayKit extension │
        │       │                                    └──────┬──────────┬────────┘
        │       │  WebRTC media + data channel               │          │
        │       └────────────── P2P (or TURN relay) ─────────┼──────────┘
        │          DTLS SRTP, end to end encrypted           │
        │                                                    │
        │ HTTPS (REST) + WSS (signaling)                     │
        ▼                                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ API server (Node.js + Express)     Signaling (Socket.IO over WSS)      │
 │  auth, devices, pairing, trust,     presence, session offers/answers,   │
 │  sessions, audit log                ICE candidates, revocation push     │
 └───────────────┬───────────────────────────────────┬────────────────────┘
                 ▼                                   ▼
          PostgreSQL                        Redis (presence, rate limits,
                                            short lived pairing state)
 Push: FCM (Android) and APNs (iOS) to wake a Host for a request or reconnect
 TURN/STUN: coturn with short lived HMAC credentials issued by the API
```

The server brokers identity, trust and signaling. It never sees screen content: media is encrypted between the phones. Signaling messages that set up media (the SDP with its DTLS fingerprint) are signed by each device's hardware key and checked against the key pinned at pairing, so a compromised server cannot silently insert itself as a man in the middle.

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| App | React Native 0.86 + Expo SDK 57 (dev builds, not Expo Go), TypeScript, Expo Router | One UI codebase; Expo config plugins keep native projects generated, not hand edited |
| Native capture | Local Expo modules in Kotlin (Android) and Swift (iOS) | Screen capture, foreground service, broadcast extension and hardware keys need native code |
| WebRTC | `react-native-webrtc` with `@config-plugins/react-native-webrtc` | Mature, supports screen capture tracks, hardware H.264/VP8 encoders |
| Secure storage | `expo-secure-store` (Keychain / Keystore backed) + native hardware key module | Secrets never in plain storage |
| Biometrics | `expo-local-authentication` | Face ID, Touch ID, Android BiometricPrompt |
| QR | `expo-camera` (scan), `react-native-qrcode-svg` (show) | |
| Backend | Node.js 22, Express, Socket.IO, Zod validation, Argon2id | |
| Data | PostgreSQL 16, Redis 7 | |
| Relay | coturn with TURN REST API (ephemeral credentials), TLS on 443 | Works through strict networks |
| Push | FCM HTTP v1, APNs (token auth) | |

## 3. Android capabilities

1. **MediaProjection** captures the whole screen, or a single app when the user picks that option in the system dialog (Android 14 QPR2+). **[verify]**
2. A **foreground service of type `mediaProjection`** keeps capture running while the Host uses other apps; it must show an ongoing notification.
3. **BOOT_COMPLETED** receiver can restore presence (sign in to signaling with stored device credentials) after a restart.
4. **FCM high priority messages** can wake the app to show a "device wants to connect" notification.
5. **ConnectivityManager.NetworkCallback** reports Wi-Fi / cellular changes immediately, which drives ICE restarts.
6. **Android Keystore** gives non exportable keys, StrongBox backed on many devices.
7. **Remote control** is possible through an **AccessibilityService** (`dispatchGesture`, global actions such as Back and Home) that the user turns on manually in system settings.
8. Android 15+ offers a callback that tells the app when it is being recorded, and system level hiding of sensitive notifications/OTPs during projection. **[verify]**

## 4. iOS capabilities

1. **ReplayKit Broadcast Upload Extension** captures the entire screen, including other apps, after the user starts it from the system picker (`RPSystemBroadcastPickerView`) or Control Center.
2. The extension runs in its own process while the broadcast is active, even with the main app in the background, and can run WebRTC itself (the pattern used by Jitsi and others).
3. **App Groups** share the device credential and session info between the app and the extension; the Keychain can use a shared access group.
4. **APNs** notifications (with a Notification Service Extension if needed) tell the user a trusted device wants to connect.
5. **NWPathMonitor** reports network changes.
6. **Keychain + Secure Enclave** P-256 keys that never leave the hardware.
7. **Local Network permission** (`NSLocalNetworkUsageDescription`) is needed for direct LAN peer connections; the prompt appears the first time.

## 5. Android limitations

1. **Consent every session.** Since Android 14 a MediaProjection consent result can be used only once, and a new session needs a new system dialog. There is no API to skip it for "trusted" apps. **[verify]**
2. **No capture from boot.** Android 15 blocks starting `mediaProjection` foreground services from a `BOOT_COMPLETED` receiver, and background apps cannot start foreground services in general. After a restart, capture resumes only after the Host taps. **[verify]**
3. **FLAG_SECURE windows** of other apps (banking, some password screens, DRM video) appear black in the capture. This is respected, never bypassed.
4. **Remote control via Accessibility** has strict Google Play policy: prominent disclosure, user must enable it in Settings, and the app must declare the use. Some OEMs also restrict it. It cannot type into secure fields of other apps.
5. **Battery optimizations / OEM killers** (Doze, App Standby, aggressive OEM task killers) may delay FCM delivery or kill the service. The app guides the user to exempt it, but cannot force it.
6. Network changes during a session need an ICE restart; the projection itself survives.

## 6. iOS limitations

1. **The user must start every broadcast.** No API starts ReplayKit capture of the whole screen programmatically; the system picker always requires a tap. Automatic reconnection after the broadcast has ended is therefore impossible; it becomes a notification plus one tap.
2. **Broadcast extension memory limit** (about 50 MB **[verify]**) forces lean encoding: downscaled frames, hardware H.264, small buffers.
3. **No remote control of any kind.** iOS has no public API for another app to inject touches or keystrokes. Viewing only, plus optional pointer/annotation overlay drawn on the Controller side.
4. **No persistent background process** for presence. The app is suspended soon after backgrounding. PushKit VoIP pushes must only be used for real calls with CallKit, so they are not used here. Standard APNs alerts are the wake mechanism.
5. **Protected content is hidden:** DRM (FairPlay) video, and the contents of secure text fields, are omitted from captures. The system also shows a red recording indicator (status bar / Dynamic Island) that cannot and should not be hidden.
6. The broadcast stops when the phone locks on some versions, and always on restart.

## 7. Pairing architecture

```
Host                          Server                          Controller
 │ POST /pairing/codes          │                                 │
 │ ────────────────────────────▶│ code = 6 random digits          │
 │                               │ nonce = 128 bit random          │
 │ ◀──── code, nonce, exp 5m ───│ store HMAC(code), HMAC(nonce)   │
 │ show 839-421 + QR(code,nonce)│                                 │
 │                               │  POST /pairing/requests         │
 │                               │◀──── code (+nonce), controller  │
 │                               │      public key, device info    │
 │                               │ check hash, attempts < 5,       │
 │                               │ rate limit per IP/device        │
 │ ◀─ WSS/APNs/FCM: request ────│                                 │
 │ Host sees Allow Once /        │                                 │
 │ Trust This Device / Deny      │                                 │
 │ (+ biometric check)           │                                 │
 │ POST /pairing/requests/:id    │                                 │
 │ { decision, permissions,      │                                 │
 │   signature by host key }    ─▶ create trusted_devices row      │
 │                               │ burn the code                   │
 │                               │ ─── approved + host public key ▶│
 │                               │                                 │ pin host key
```

1. The code is single use, expires in 5 minutes, and allows at most 5 wrong attempts before it is burned. A 6 digit code with 5 tries gives an attacker at most a 1 in 200,000 chance, and the Host must still approve.
2. The QR adds the 128 bit nonce, so scanned pairing is strong even without the approval step. It holds no passwords, keys or tokens.
3. Both phones exchange public keys at pairing and pin each other's key. Future connections are authenticated by those keys, not by the code.
4. **Allow Once** creates a session scoped grant that expires when the session ends. **Trust This Device** creates a persistent trust row until revoked.

## 8. Automatic reconnection architecture

**Device authentication (no code needed after pairing):**
1. Device asks `POST /auth/device/challenge` and gets a random nonce (single use, 60 s).
2. Device signs `nonce || deviceId || timestamp` with its hardware key.
3. Server verifies against the registered public key, checks the device is not revoked, and issues a 10 minute access token plus a rotating refresh token.

**Reconnect triggers and what each platform can do:**

| Event | Android Host | iOS Host |
|---|---|---|
| Brief network drop / Wi-Fi ↔ cellular during a session | Fully automatic: ICE restart, TURN fallback, capture continues | Fully automatic while the broadcast is running |
| App killed / swiped away | Notification "Resume sharing with X", one tap + system consent | Notification, one tap on the broadcast picker |
| Phone restart | Presence restored at boot; Host gets a notification when a trusted Controller wants to connect; capture needs a tap + consent | After first unlock, APNs notification when the Controller asks; one tap to start the broadcast |
| Controller side restart | Fully automatic: Controller re-authenticates and reconnects if the Host is still sharing | Same |

**Session recovery:** the server keeps a session alive for 60 seconds after both sides lose signaling. Either side reconnecting within that window resumes the same session (ICE restart, new SDP), so history shows one session, not many. After that, the Controller retries with exponential backoff and jitter (1 s, 2 s, 4 s ... capped at 60 s), and the UI shows "Connection lost. Trying to reconnect...".

Both **Automatic Reconnection** (global) and **Automatically Connect** (per device) can be switched off. Turning either on requires biometric confirmation.

## 9. WebRTC architecture

1. **Topology:** one peer connection per session, Host sends one video track, plus a data channel for control events, quality hints and "content hidden" notices.
2. **ICE:** STUN first, TURN over UDP, then TURN over TLS 443. TURN credentials are HMAC based and valid for 1 hour, issued only to an authenticated device with an active session. `iceTransportPolicy: 'relay'` is available if the user disables direct connections.
3. **Security:** DTLS SRTP is mandatory in WebRTC. Each side signs its SDP fingerprint with its device key; the peer rejects a fingerprint not signed by the pinned key.
4. **Encoding:** hardware H.264 on both platforms (VP8 fallback). Screen content hint `detail` for sharp text. Start around 720p at 15 to 30 fps.
5. **Adaptation:** WebRTC's congestion control adjusts bitrate; resolution scaling via `scaleResolutionDownBy` and `maxBitrate` per quality preset (Low about 300 kbps, Medium about 1 Mbps, High about 2.5 Mbps, Auto uses bandwidth estimation). Degradation preference `maintain-resolution` so text stays readable.
6. **Network change:** on NetworkCallback / NWPathMonitor events, trigger `restartIce()`; when Wi-Fi returns while on TURN, restart ICE again to try to go back to direct.
7. **Protected content:** the Host cannot see what the OS hides from capture. The Controller detects sustained all black regions and shows "Sensitive content is temporarily hidden by the device." instead of a failure.

## 10. Security model

1. **Transport:** TLS 1.3 for REST and WSS; HSTS; certificate pinning (backup pins) in the app.
2. **User auth:** Argon2id password hashes; 10 minute JWT access tokens (ES256); opaque refresh tokens stored only as SHA-256 hashes, rotated on every use, with reuse detection that revokes the whole token family.
3. **Device identity:** hardware backed P-256 key per device (Keystore / Secure Enclave), non exportable, public key registered with the server.
4. **Authorization:** every signaling message is checked server side against `trusted_devices` (status, direction, permissions) at the moment it is sent, not just at login.
5. **Revocation:** Remove Access sets the trust row to `revoked`, deletes active session grants, pushes a `revoked` event over the socket that closes the peer connection on both phones, and blocks future challenges from that pair. Access tokens are short lived and also checked against a revocation list in Redis.
6. **Replay protection:** single use nonces for device challenges and pairing, timestamps checked within 60 s, session IDs bound to the pair.
7. **Rate limits:** pairing requests per IP, per device and per code; login attempts per account with backoff.
8. **Logging hygiene:** a redaction layer strips passwords, PINs, pairing codes, tokens and keys before anything is logged. Audit events (paired, approved, denied, connected, revoked) are stored without secrets.
9. **Own screens are not black:** the app never sets FLAG_SECURE on its own login and pairing screens, so helpers can see them. Password characters are still masked. Other apps' protections are never touched.
10. **Consent visibility:** the in app "Screen Sharing Active" banner with Stop Sharing is always shown in addition to the OS indicators.

## 11. Database schema

Full SQL: [`backend/database/schema.sql`](../backend/database/schema.sql). Summary:

| Table | Purpose |
|---|---|
| `users` | Account: email, Argon2id password hash |
| `devices` | One row per installed app: name, type, OS, public key, push token, last seen |
| `trusted_devices` | Host to Controller relationship: status, permissions, auto connect, timestamps |
| `pairing_codes` | Hashed short lived codes and nonces with attempt counters |
| `pairing_requests` | Pending approvals |
| `refresh_tokens` | Hashed refresh tokens with family ids for rotation |
| `sessions` | Each screen sharing session with start, end and end reason |
| `audit_events` | Security relevant events for Connection History and investigations |

## 12. Project folder structure

```
marie.js-/
├── documentation/          This file and later runbooks
├── mobile/                 Expo app (Phase 1 lives here)
│   ├── app.json            App config + config plugins
│   ├── src/
│   │   ├── app/            Expo Router screens (routes only)
│   │   ├── components/     Reusable UI
│   │   ├── hooks/
│   │   ├── services/       api contract, mock api, secure storage, biometrics, pairing payload
│   │   ├── state/          App store (React context + reducer)
│   │   ├── theme/          Light and dark palettes
│   │   ├── types/
│   │   └── utils/
│   └── modules/            (Phase 6+) local native modules
│       ├── screen-capture/ Kotlin MediaProjection + foreground service, Swift broadcast bridge
│       ├── device-keys/    Keystore / Secure Enclave keys
│       └── remote-input/   Android AccessibilityService
├── backend/                (Phase 2+) Express API + Socket.IO signaling
│   ├── src/{auth,devices,pairing,signaling,sessions,security}
│   └── database/schema.sql
└── infra/                  (Phase 5+) coturn config, docker compose
```

Signaling lives inside the backend process at first (same auth, simpler deploy) and can be split out later behind the Socket.IO Redis adapter.

## 13. Development phases

| # | Phase | Output |
|---|---|---|
| 1 | UI | All screens with a mock API and realistic states **(done in this change)** |
| 2 | Authentication | Express API, register, login, JWT + rotating refresh, device key registration |
| 3 | Pairing | Codes, QR nonce, request/approve/deny, trust rows, revocation |
| 4 | Signaling | Socket.IO, presence, session negotiation, connection states from the server |
| 5 | WebRTC | Peer connection, coturn, signed fingerprints, video in the viewer |
| 6 | Android capture | MediaProjection module, foreground service, notifications |
| 7 | iOS capture | Broadcast Upload Extension with WebRTC inside it, App Group |
| 8 | Auto reconnection | Device challenge login, push wakeups, ICE restarts, backoff, session recovery |
| 9 | Security review | Threat model pass over all of the above |
| 10 | Testing | The 13 scenarios on real devices |

## 14. MVP definition

The MVP is Phases 1 to 6 plus the reconnection parts of Phase 8 that apply to Android:

1. Account sign up and sign in.
2. Pair two phones with a code or QR; Host approves with Allow Once or Trust.
3. Android Host shares its screen; Android or iOS Controller views it live over Wi-Fi or cellular, with TURN fallback.
4. Trusted devices list with rename, auto connect toggle and Remove Access.
5. Automatic recovery from network drops and network switches during a session.
6. Connection history and the always visible sharing banner with Stop Sharing.

iOS Host sharing and Android remote control follow right after the MVP.

## 15. What cannot be built exactly as requested

1. **Fully silent reconnect after a Host restart or app kill.** Both OSes require the user to start screen capture again (Android consent dialog, iOS broadcast picker). PeerView gets as close as allowed: presence and trust are restored automatically, and the Host gets one notification to tap.
2. **Remote control of an iPhone.** Not possible with public iOS APIs. iPhones can be viewed only.
3. **Seeing protected content.** Banking apps, DRM video and secure password fields of other apps stay hidden or black. PeerView shows a friendly notice instead of failing.
4. **Password fields on iOS inside our own app** may show as blank in the stream because iOS omits secure text field contents from captures. The rest of the screen stays visible and the connection is not interrupted.
5. **Always on background presence on iOS.** The app cannot keep a socket open in the background, so iOS Hosts appear "Offline" until a push is tapped or the app is opened.
6. **Remote control on Android** needs the user to enable an Accessibility Service in system settings once, and is subject to Play Store policy review.
