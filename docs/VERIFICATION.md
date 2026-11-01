# Verification record

The initial playable implementation was checked on 1 November 2026.

- TypeScript strict type check: passed.
- Automated game and real Socket.IO integration tests: 16 passed.
- Expo dependency compatibility check: passed.
- Expo export: Android and iOS Hermes bundles, plus web bundle, generated successfully.
- Expo native project generation: Android and iOS projects generated successfully.
- Two-browser UI smoke test at 390 × 844: created room, joined second player, restored the second seat after reload, marked ready, chose words, drew synchronized strokes, sent chat, guessed correctly, completed one full round, displayed scores, and started a rematch. No browser page errors.
- Visual inspection: home, lobby, drawing, guessing, and results screens inspected.

Native binary compilation status is reported by the [GitHub Actions workflows](https://github.com/iAdityaD/Scribbles/actions), not by JavaScript export. Physical-device testing, live HTTPS hosting and production signing remain release requirements. See TESTING.md for the device checklist.

The custom-set update adds a repeatable UI smoke script covering minimum word count, persistence, dropdown selection and a full custom-word match.

## Nearby architecture update — 2 November 2026

- Audit completed before modification: baseline 16 tests and TypeScript checks passed.
- All 23 tests pass after the update: existing core/socket tests plus SocketTransport, six simulated Nearby devices, word privacy, canvas recovery, live drawer chat, scoring, pairing rejection, permission denial, framing limits/order/Unicode, host suspension, cancellation and interrupted-request recovery.
- Strict TypeScript check passes.
- Android/iOS Hermes and web exports pass. Existing two-browser custom-word match, reload/reconnect, drawing, drawer-visible chat, results and rematch smoke test passes without browser errors.
- Expo Android prebuild passes; local module autolinking resolves `com.iadityad.scribbles.nearby.ScribblesNearbyModule`. A stale local generated image cache needed regeneration; source artwork was unchanged.
- Android release APK compilation passed, including `:scribbles-nearby:compileReleaseKotlin`, at architecture commit `ee39749b6e525a90a43a85bc538daf6bf1ec81e8`: [native build](https://github.com/iAdityaD/Scribbles/actions/runs/41338166932). The native module is unchanged by subsequent TypeScript lifecycle fixes.
- The final implementation commit `3a0fb64026dd903b5dae399924dccfd7d76cd851` passed [all GitHub checks](https://github.com/iAdityaD/Scribbles/actions/runs/41338658323), including 23 tests, type checking, exports and UI smoke. Its APK rebuild is tracked [here](https://github.com/iAdityaD/Scribbles/actions/runs/41338658227). APKs from this workflow use the test/debug signing key, not a production Play Store key.
- JavaScript export, native compilation and simulated radios do not establish physical radio compatibility.
- No physical phones are attached to this environment. The 4–6-device offline checklist in [NEARBY_MULTIPLAYER.md](NEARBY_MULTIPLAYER.md) remains a release gate. No internet backend was deployed or changed in hosting.
