# Verification

Automated tests cover secret-word and token isolation; scoring and duplicate submissions; drawer-only canvas changes; undo/redo/clear; answer normalization and chat filtering; host migration and seat expiry; late joins; full matches/rematches; pause/resume; validation; room isolation; and real Socket.IO create/join/chat/draw/reconnect/kick flows.

Run `npm run typecheck`, `npm test`, and `npm run export:mobile`. CI performs the same checks.

## Native release checklist (requires actual devices or simulators)

- [ ] Install Android APK and iOS signed development build.
- [ ] Create on Android, join on iPhone over a different network.
- [ ] Draw fast/slow curves, dots, undo/redo, erase and clear on both platforms.
- [ ] Check 320–430dp phones, tablet layout, keyboard open/close and large text.
- [ ] Background, foreground, lose Wi-Fi, switch to cellular, then resume the same seat.
- [ ] Confirm invite deep links open a cold app and an already-running app.
- [ ] Check correct answer never appears on another guesser's device before reveal.
- [ ] Exercise 8 players, spectators, absent drawer, host leave and all players leaving.
- [ ] Run a complete match and rematch, including a custom word pack.
- [ ] Verify VoiceOver/TalkBack labels and sufficient control hit targets.
- [ ] Use HTTPS backend, permanent signing keys and store privacy disclosures before publication.

A successful JavaScript/Hermes export does not prove native rendering, signing or device networking. Report those checks separately.

## Custom-set and UI coverage

Additional tests cover the 19/20-word boundary, canonical duplicates, maximum word count, selected-set-only choices, configured choice count, hint timing and locked mid-game joins.

After exporting, install Chromium with `npx playwright install chromium` and run `npm run test:ui`. The smoke test rejects a 19-word set, saves 20 words, reloads to verify persistence, selects the set from the dropdown, configures a custom room, then completes a two-player drawing/chat/guessing match and rematch. CI runs the same script and uploads screenshots.
