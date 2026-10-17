# Local options and feature audit

Checked October 17, 2026 using Chromium, actual pinned game servers, and built client packages. Desktop and narrow-window checks simulate Chromebook constraints; a physical managed Chromebook was not available.

## Fixes

- Browser Host/Join controls recognize an installed LoreScape room bundle and open its saved-world/room-code lobby. This prevents starting its worker through the incompatible clipboard workflow. External clipboard bundles remain supported; missing workers/data still produce setup instructions. Complete room bundles require domain-root hosting; placing one under a project subdirectory now produces guidance instead of opening a broken lobby.
- Relay does not construct a WebRTC connection. Automatic mode can use relay when WebRTC is missing or a device policy rejects it. A host without WebRTC can also offer relay.
- RTC-only mode retains the user's transport choice, gives recovery guidance after 30 seconds without a connection, and preserves useful connection errors when returning to the lobby.
- The server kit keeps `localhost`, `127.0.0.1`, and configured IPv6 loopback setup links on the browser's origin. A configured public HTTPS origin takes precedence. Arbitrary Host headers cannot choose a different server address.

## Verification matrix

| Option or feature | Verification |
| --- | --- |
| Downloaded server kit / world 0 | Extracted the current ZIP, started the server, logged in, returned to the launcher, and relaunched. |
| Reinstall and server shutdown | Graceful shutdown; reinstall preserved byte-for-byte hashes of two keys, settings, and three existing player saves. |
| Restricted browser storage | Logged in through `localhost` with IndexedDB and localStorage blocked. Server-owned saves and game downloads remained usable. |
| Connected local tools | Models, items, sounds, interface editor, map and chat animations loaded without public services. Sound playback used decoded audio. |
| Classic cache export/import | Real server export loaded 3,454 model slots. ZIP, DEFLATE ZIP, nested folders and individual-file recovery worked in Cache viewer and JagEd. |
| Saved caches | Reload/new-tab auto-load, replacement imports, atomic write rollback, and current-tab imports with storage blocked passed. |
| Browser hosting/joining | Four room-code clients exchanged player updates with WebRTC disabled. Fifth-player rejection, slot reuse, settings, automatic checkpoints and host restart restoration passed. |
| Complete offline package | Download integrity, cancellation, failed updates, quota failures and retention of an older usable pack passed. |
| Offline gameplay | Logged in after stopping the file server. Restart restored character XP/items, selected world and preferences. |
| Save management | Recovery, exporting unsaved progress after quota failure, rename, explicit deletion, and removing game downloads without deleting saves passed. |
| Static solo package | Optimized solo build, login, device preferences, saves, offline download and portable backup checks passed without a room service. |
| Private server files | Real gateway requests for private keys, environment files and player saves returned 404. Public login configuration exposed only the public key parameters. |

All 245 client/unit tests, 11 service tests, and 20 gameplay scenarios passed. The browser suites additionally checked local installation, cache tools, offline data and transport recovery.

The gameplay sweep also exercises character creation, tutorial choices, movement between map regions, camera/tabs, woodcutting, fishing, mining, combat, boosted XP/loot, food, chat, host removal, portable backups, repeated sessions and keyboard/battery controls. Results are recorded by `tools/tests/browser-personas.cjs`.

## Reproduce

Run the usual lint, type, unit, service and Pages checks from README. `npm run test:launcher` includes missing-bundle recovery and Host/Join routing checks.

With the pinned server content prepared, use `npm run build:web` and `npm start` for production co-op, or `npm run build:web:solo` for static solo. Browser suites accept `LORESCAPE_CHROMIUM_PATH` and `LORESCAPE_TEST_URL`; offline/download suites also accept `LORESCAPE_OFFLINE_DIR` and `LORESCAPE_DOWNLOAD_DIR` to isolate their built packages. `LORESCAPE_DISABLE_RTC=1 LORESCAPE_TRANSPORT=auto npm run test:coop` verifies the restricted-WebRTC path. Build development co-op assets before running that smoke suite.

The solo package was built into an isolated directory during this audit so the co-op gameplay sweep could continue against its original package.

## Limits

Direct WebRTC did not connect in this environment. An independent browser-only peer probe also failed to open a channel. Direct RTC-only gameplay is therefore not claimed as verified; Automatic/Relay is the tested alternative, and the bounded RTC-only recovery path is checked separately.

A normal GitHub Pages deployment includes the launcher and tools, rather than a running server or a complete browser server bundle. Locked-down Chromebooks without Linux cannot install the native kit. They can use an allowed HTTPS-hosted server or complete browser package when device policies permit its website, files, storage and game connections. Relay still requires an allowed WebSocket connection. These checks do not establish access under a particular school's or employer's policies.
