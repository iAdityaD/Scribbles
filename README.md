# Scribbles

Private drawing-and-guessing game for Android and iOS. Create a room, invite friends, draw live, guess, and chat. There is no public matchmaking.

## Implemented

- Shared React Native + Expo app with the supplied dark/yellow/cream visual direction, original vector cat artwork and app icon.
- Guest nickname/avatar, create/join by six-character code, share invitation and `scribbles://join/CODE` deep links.
- Lobby chat, ready states, host settings, reusable 20–100-word custom sets, 2–12 seats, 1–10 rounds and 30–180 second turns.
- Room mode: **Random words** (Classic/Animals) or **Custom set** selected from a dropdown. Create, edit and delete named sets on your device. Each room receives its own copy.
- More game options: 1–3 word choices, 0–3 timed letter hints, 10–30 seconds for word selection, and mid-game joining on/off.
- Live normalized vector strokes, pencil, eraser, 8 colours, 3 brush sizes, undo/redo and confirmed clear.
- Server-owned word selection, turn deadlines, guessing, scoring, word reveal, leaderboard and rematch.
- One conversation feed with Guess/Chat mode, hidden correct answers, spoiler filtering, local chat mute and host removal.
- Reconnect tokens, state recovery, host transfer, late-join spectators, disconnect grace periods and input/rate/size validation.
- Automated core and Socket.IO integration tests, CI, native build workflows and Docker deployment configuration.

## Run locally

Node 22+ and npm are required. From the repository root:

```bash
npm ci
npm run start:server
```

In another terminal:

```bash
cp apps/mobile/.env.example apps/mobile/.env
# Set EXPO_PUBLIC_SERVER_URL to http://YOUR-COMPUTER-LAN-IP:3001
npm run dev:mobile
```

The server listens on port 3001. Both devices must reach the **same** server. On a physical phone, `localhost` means the phone, not your computer. Use an HTTPS endpoint for standalone native builds. An Expo SDK 54-compatible development environment is needed; if the current Expo Go client no longer supports SDK 54, use a development build or the native workflow below.

The app also exposes **Settings → Game server** for self-hosted play. A configured build uses `EXPO_PUBLIC_SERVER_URL`; a local fallback is `http://localhost:3001`. No public backend is bundled or deployed by this repository.

Open the app in two devices/sessions. Set nicknames, create a room on the first, join its code on the second, mark the second ready, then start as host.

## Validate

```bash
npm run typecheck
npm test
npm run export:mobile
```

For the two-player UI smoke test, run `npx playwright install chromium` once, then `npm run test:ui` after exporting. CI also runs it.

`export:mobile` creates Android and iOS Hermes bundles plus a web bundle. Bundles are **not** installable native binaries. See [test coverage and device checklist](docs/TESTING.md).

## Android APK / iOS

Use GitHub Actions → **Native test builds** → Run workflow. Choose Android, iOS, or both and optionally supply the HTTPS server URL.

- Android: produces a release-mode **test APK signed with the generated debug key**. This is for sideload testing, not Play Store publishing or stable update identity.
- iOS: produces an unsigned simulator `.app`, not an iPhone-installable IPA.
- Store releases: configure `apps/mobile/eas.json`, your Expo project, permanent Android signing key, and Apple signing credentials. Run EAS from `apps/mobile`. TestFlight/device distribution requires the appropriate Apple developer account and provisioning.
- EAS cloud uploads must include the workspace root, package lock, and shared `packages/` directories. Build from the mobile app directory in this npm workspace.

No production signing credentials are committed. Generated native projects are ignored and recreated by Expo prebuild.

## Deploy the multiplayer server

See [deployment instructions](docs/DEPLOYMENT.md). A Dockerfile and Render blueprint are included. Provisioning a host, choosing its paid plan, and configuring DNS/TLS are separate actions; `render.yaml` is a deployment template, not evidence of a live service.

## Architecture

```text
apps/mobile/          Expo app, screens, vector canvas and socket/session hook
apps/server/          HTTP health endpoint and Socket.IO transport adapter
packages/protocol/    Shared types and Zod command validation
packages/game-core/   Pure room state machine and bundled word packs
 tests/               Game rules and actual socket integration tests
```

The server holds the authoritative room. Clients receive a personalized snapshot; only the drawer receives choices and the live answer. Socket.IO transports ordered stroke updates, and missing revisions trigger full state synchronization. All round timestamps originate on the server. A seat token, not a socket ID or nickname, restores a disconnected player.

Implementation choices: the initial app uses a simple screen state machine (three entry screens and server-driven room phases) rather than a navigation framework; native deep links are handled explicitly. SVG vector paths replace Skia for this bounded, single-drawer canvas; points and strokes are capped and updates are batched. Both can be replaced behind their current component boundaries if later profiling warrants it.

## Current limits

- Live rooms are in memory on **one server process**. Restart/deploy loses rooms; horizontal replicas are not supported yet. Use one always-on instance. Redis-backed persistence/room ownership is future work.
- Guest identities and room codes are for private friend groups. Hosts can remove someone, but this is not an account-level ban. Answer filtering blocks normalized answer text, not every possible hint or deliberate evasion.
- English word packs, text chat, and portrait gameplay initially. Voice chat, public matchmaking, accounts, paid skins and push notifications are out of scope.
- Native device smoke tests and signed release distribution must be completed before calling this an App Store/Play Store release.

See [game rules](docs/GAME_RULES.md) for precise defaults and failure behaviour.
