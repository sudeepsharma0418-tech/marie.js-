# PeerView mobile app

Expo (SDK 57) + React Native + TypeScript. See `../documentation/ARCHITECTURE.md` for the full design.

## Phase 1 status

All screens are built against a mock backend (`src/services/mockApi.ts`) that behaves like the real one: latency, expiring single use codes, and wrong code errors (any code starting with `0` is rejected so you can see the error state).

To try the Host approval flow on one phone, open Share My Screen and tap **Simulate incoming request (dev only)**. Sign in with any email and a password of 8+ characters.

## Run

```bash
npm install
npx expo start          # works in Expo Go for the Phase 1 UI
npm run typecheck
```

From Phase 5 on (WebRTC and screen capture) the app needs a development build: `npx expo run:android` / `npx expo run:ios` or `eas build --profile development`.
