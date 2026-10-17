# Private co-op verification

Verified October 11, 2026 (UTC), in the managed cloud workspace.

| Check | Result |
| --- | --- |
| Upstream provenance | LoreScape initially matched archived Client2 commit `43473be3faaab6e0564ca1a3ca51fbe729bdf66f`. Original Server is archived; continuing development is under LostCityRS. |
| Pinned server setup | Passed dependency installation, RuneScript compiler 20, packed game data and browser bundle at server revision `c9a041799e9893a3174be433ca884837254f262b`. |
| Client builds | Full development build, focused `build:coop`, optimized co-op client, and full production build across all nine client/editor entry points passed. Production builds retain webpack size advisories. |
| TypeScript and lint | `npx tsc --noEmit` and repository-wide `npm run lint` passed. |
| Existing client tests | 14 suites, 77 tests passed. |
| Room/protocol/storage tests | Nine tests passed: reservations/capacity, authorization, identity binding, expiration, packet/settings validation, NPC loot classification, exhausted shop-stock persistence, character framing/prototype keys, device preferences and portable sparse-world backups. |
| Native IndexedDB browser checks | Three snapshots retained; corrupt latest snapshot falls back; aborted writes preserve committed data; invalid/tampered archives fail; explicit recovery succeeds; export imports into an independent browser profile. |
| Four-player game integration | Host plus three guests logged in through room codes and received player updates in four isolated Chromium profiles using relay. Fifth participant rejected. |
| Session lifecycle | Same save cannot be hosted in two tabs; departure frees a slot; automatic mode falls back and reconnects; forged host connection ID does not replace the host socket; closing the host notifies guests; immediate room-to-solo switching succeeds. |
| Gameplay settings | Worker assertions confirm XP ×5 and NPC death-drop quantity ×3 with shared ownership. Settings survive a restart. |
| Automatic save and restart | Periodic checkpoint stores all four characters and shared world state. Host restart restores XP, coins, shared inventories, world variables and settings; guest XP and coins survive too. |
| Offline single-player | Full hashed download, failed-update retention, server-stopped/network-blocked login and restart, intentionally failed legacy asset-cache writes, live FPS/fullscreen/window fit, Ctrl+S, device/world restoration, quota error/emergency export/pending-character rejoin, world rename/deletion, and offline-file removal preserving saves passed. Active sessions block asset removal from other tabs. |
| Optimized client runtime | Minified client connects to the standalone lobby and worker, applies device preferences, logs in, loads the scene and saves its character. |
| Browser runtime | Co-op and offline integration tests finish without unexpected browser runtime errors. |
| Eight player styles | Twenty scripted gameplay scenarios pass after fixes and targeted reruns: tutorial, exploration, skilling, combat, party chat/kick, portable backup login, quota recovery, rapid clicks and device controls. See [gameplay report](PERSONA-TEST-REPORT.md). |
| Pure WebRTC / physical devices / separate networks | Not verified. Managed Chromium policy sets `WebRtcIPHandling=disable_non_proxied_udp`; offer/answer exchange produces zero local ICE candidates. Use suitable external devices and TURN as needed. |

Environment: Node 24.19.0, npm 11.9.0, Java 21, system Chromium and Playwright. The integration test instruments client/worker responses only inside the test; there is no production test command endpoint. Worker/browser adapters include the archived server's missing browser UUID dependency and safe cleanup of closed streams.

Browser tests used the existing managed installations:

```sh
LORESCAPE_PLAYWRIGHT_PATH=/opt/codex/cua_node/lib/node_modules/playwright \
LORESCAPE_CHROMIUM_PATH=/usr/bin/chromium \
npm run test:coop

LORESCAPE_PLAYWRIGHT_PATH=/opt/codex/cua_node/lib/node_modules/playwright \
LORESCAPE_CHROMIUM_PATH=/usr/bin/chromium \
node tools/tests/browser-storage.cjs
```

Use your own installed module/browser paths outside this workspace. The default multiplayer smoke uses application relay. `LORESCAPE_TRANSPORT=rtc` requests WebRTC-only validation; managed policy was not changed to bypass its restrictions.

The persistence contract is limited to permanent character data, shared inventories, world variables, world tick and settings. NPCs, ground items and temporary scenery/script state restart. Browser storage loss needs an exported backup. The four profiles above are on one machine; results do not claim four physical devices or production Internet reliability.

Launch with `npm run coop`; see [setup](COOP-SETUP.md). Screenshots: ignored `.local/coop-party.png` and `.local/offline-solo.png`. Generated assets, checkouts and saves remain local. No deployment or remote repository publication was performed.

## Audit follow-up

See [the audit](CODE-AUDIT.md) for the resolved storage and transport issues and [setup](COOP-SETUP.md) for offline/device controls. The offline browser test uses a disposable verified cache with test-only client/worker instrumentation, then stops its isolated static HTTP server and blocks network access. The generated development pack contains 2,789 files, about 28.8 MiB, including both client and server data.

Run `npm run test:offline` with the same Playwright/browser path variables as the other browser tests. Chromium window sizes and rendering preferences are tested; physical Chromebook benchmarks, ChromeOS sleep/resume, and OS app installation remain external checks. A persistence request may be declined by browser policy.

`npm run test:storage` runs the native IndexedDB checks. `npm run test:production` builds an isolated optimized client under `.local/production-client` and runs its browser check against the local co-op server; it preserves the development game pack used by the other browser tests. The dependency advisory lookup timed out without a report, so dependency advisories remain unverified.

`npm run test:personas` runs 20 gameplay scenarios across eight behavior profiles using the development co-op client and the same browser path variables. `LORESCAPE_SCENARIOS=14,15` selects targeted reruns. The [gameplay report](PERSONA-TEST-REPORT.md) documents setup fixtures, fixes and per-case evidence; these are automated sessions, not exhaustive playthroughs.
