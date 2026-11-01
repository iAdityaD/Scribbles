# Android offline multiplayer

## Audit completed before changes (2 November 2026)

Baseline: main `5d2dde7d461262934105b5ce173d1cd3e9e75e06`. All 16 existing tests and strict TypeScript checks passed before edits.

- `packages/game-core/engine.ts` already contained the rules, scoring, timers, visibility filtering and canvas. Its only platform-specific dependency was `node:crypto`.
- `apps/server/src/server.ts` mixed Socket.IO with validation, request deduplication, seat ownership, reconnects, kicks and broadcasts.
- `apps/mobile/src/useGame.ts` directly constructed a Socket.IO client and performed session recovery.
- `App.tsx` already displays chat below the drawing canvas, including for the drawer. No new drawing or chat screen was needed.
- No native module existed. The EAS development profile did not enable a development client.

Minimum implementation: portable randomness, reusable host runtime, a transport interface with existing Socket.IO adapter, a Kotlin Nearby bridge and a Nearby adapter, plus a connection selector. Existing protocol, word sets, SVG canvas, navigation and rules are retained.

## Architecture

`useGame → GameTransport → SocketTransport → Node HostRuntime` for online play.

`useGame → GameTransport → NearbyTransport → Kotlin Nearby Connections → host phone HostRuntime` for offline play. The host's own UI uses an in-process connection to that same runtime. Guests connect to the host, not to each other.

- `packages/network/transport.ts`: connection lifecycle, typed events, request/ack, snapshot sync and foreground state. A future internet P2P transport can implement this without changing screens or rules.
- `packages/game-core/runtime.ts`: validates all commands, owns sessions, limits, deduplication, kicks, private snapshots and ticking. The online server is now only an adapter.
- `packages/game-core/random.ts`: injectable secure random-byte source. Node uses Web Crypto; mobile uses Expo Crypto. No Node imports enter the mobile game core.
- `packages/network/NearbyTransport.ts`: owns the local host or guest session; discovering, pairing, reconnect, heartbeat, snapshot recovery and disposal.
- `packages/network/framing.ts`: protocol version 1, sequence numbers, bounded fragmentation/reassembly, duplicate handling, ordered delivery and transfer timeout.
- `apps/mobile/modules/scribbles-nearby`: autolinked local Expo Kotlin module using Google Nearby Connections `P2P_STAR`.

Offline capacity is **2–6 players including the host**, targeting friend groups of 4–6. Online capacity remains 2–12. Local hosting enforces its limit independently of the UI.

## Playing

1. Install the native Android app on each phone. Select **Nearby · Offline**. No server URL, Firebase, cloud account or internet connection is needed for a local match.
2. Enable Wi-Fi and Bluetooth. Older Android versions also need Location permission/services for discovery. Nearby chooses its radio connection; joining the same Wi-Fi/hotspot is allowed but not required.
3. The creator sets rules and creates a room. Share the six-character room code in person.
4. Guests enter that code. Each side compares and accepts the native pairing code. A room code is a discovery label, not authentication.
5. Ready up and play. The host phone chooses words, scores guesses and runs timers. Drawing and chat remain on the same screen.

Switch to **Online** to use the existing Socket.IO backend and saved server URL. Local sessions do not reuse or persist online seat tokens. Online remains available on Android, iOS and web; Nearby is Android-only in this increment.

## Native builds

Use Node 22+, JDK 17 and the Android SDK required by Expo SDK 54.

```bash
npm ci
cd apps/mobile
npx expo prebuild --platform android
npx expo run:android
# Subsequent development sessions:
npx expo start --dev-client
```

Alternatively use `eas build --platform android --profile development`. The development profile now sets `developmentClient: true`. Expo Go cannot load this module.

For a fully disconnected test, install a **bundled standalone APK**, e.g. the Android native workflow artifact or `eas build --platform android --profile preview`. A development client needs its JS bundle from Metro; that development dependency is not a multiplayer server. The standalone APK includes its bundle and needs neither Metro nor the Node backend.

The local module's manifest declares Bluetooth and Wi-Fi permissions; JS requests runtime permissions only on create/join in Nearby mode. Bytes-only transport needs no storage, camera or microphone permissions. SDK 54 currently targets Android 36; re-audit local-network permission requirements before targeting SDK 37+. Google Play services must already be installed and usable; initial installation/updates of Play services can require internet. Unsupported devices get an explicit error instead of cloud fallback.

## Reliability and boundaries

- Guests reconnect to the same running host and resume with an opaque seat token for up to 60 seconds. Snapshots restore scores, chat, phase and canvas. Reconnection still requires pairing confirmation if the native connection is re-established.
- Screen sleep is prevented while a local room is open. Backgrounding the host freezes game deadlines; guests see a waiting state. Foregrounding resumes deadlines and publishes state. Long background suspension may disconnect guests; there is no foreground service or promise that Android keeps the process alive.
- **Host departure/process death ends the local match.** There is no authority election or secret-state replication. Online role transfer still works as before because its server stays alive. Automatically promoting a guest UI to host would not transfer the game engine and is deliberately not represented as migration.
- Local host memory is not a durable save. Relaunching after process death requires a new room. Keep the host app open throughout the game.
- Each recipient gets its own filtered snapshot. Non-drawers receive no active answer/choices; guest snapshots exclude custom word lists and all seat tokens. The host device is trusted, as is appropriate for a private friends game; this is not anti-cheat infrastructure.
- Byte frames are conservatively capped below 32 KiB. Logical messages are bounded to 1.5 million JS characters, aggregate buffers to 3 million; partial messages expire after 15 seconds. Frames are sequenced and assembled before delivery. Failed/slow connections are closed for recovery rather than growing queues without bound.
- Existing bounded strokes are retained: up to 500 strokes / 20,000 points, with batched current-stroke updates. Delta compression is a future performance optimization; test real radios with dense canvases before release.
- No automatic switch from local to online and no silent cloud dependency. Remote P2P signaling/TURN is outside this change; online uses the working Socket.IO path.
- The Nearby SDK may collect Google SDK usage diagnostics; consult its current disclosure requirements when preparing Play Store Data Safety. The game itself does not add analytics or upload local room data.

## Validation and release gate

Automated tests exercise shared rules, real online sockets and the SocketTransport adapter; simulated Nearby endpoints cover six-player hosting, unauthorized commands, private words, live drawer chat, drawing, scoring/deduplication, guest reconnection with canvas recovery, kick, closure, permission/pairing failures, malformed and reordered fragments, Unicode and host deadline suspension. Native API behavior is not simulated as proof of physical radio compatibility.

Before calling offline multiplayer device-verified, run on **4–6 real Android phones** with Google Play services:

- Android 10/11, 12 and 13–16 permission variants: allow, deny, permanent deny, restore in Settings; Bluetooth/Wi-Fi off and Location services off where required.
- Turn off mobile data and router WAN (or use airplane mode then re-enable Wi-Fi/Bluetooth); play a complete random and custom-word match with no Node server or Metro.
- Check both pairing codes; reject one, retry, and ensure unrelated advertised rooms are ignored.
- Fill all six seats; reject a seventh without disrupting existing players.
- Draw a dense canvas while all guests chat; verify the drawer sees chat and no answers leak.
- Walk out of range, reconnect within 60 seconds, verify same seat, score and full canvas. Repeat after expiry.
- Background/lock the host, restore, unplug network, force-stop host and guest, leave voluntarily, kick a guest, create another room, switch modes.
- Run a full six-player match and rematch; observe frame latency, battery and memory on low-end devices. Nearby simultaneous-connection quality varies by hardware.

Sources: [Nearby overview](https://developers.google.com/nearby/connections/overview), [strategies](https://developers.google.com/nearby/connections/strategies), [permissions](https://developers.google.com/nearby/connections/android/get-started), [authentication](https://developers.google.com/nearby/connections/android/manage-connections), [Expo local modules](https://docs.expo.dev/modules/get-started/).
