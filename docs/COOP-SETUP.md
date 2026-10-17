# Running LoreScape offline and private co-op

Prerequisites: Node 22+, npm, Java 17+, Git, and a current Chromium-based browser. First setup downloads dependencies and the RuneScript compiler, then packs the pinned server's game content.

```sh
npm ci
npm run setup:coop
npm run coop
```

Open http://localhost:8080/coop.html. **Play solo** runs without a room service, or create a private room for friends. Create a named world, wait for **World ready**, then use the game's **Existing User** button with a character name. Share the eight-character room code with up to three friends. Guests open the same site's lobby, enter the code, join, and log in with distinct character names. Local character names identify saves; this offline mode does not authenticate real RuneScape accounts. Use an arbitrary private-session password rather than a real account password.

The launcher binds to loopback by default. For other devices, serve the same application over HTTPS with WebSocket upgrades forwarded to `/signal`, and set `LORESCAPE_BIND` to an appropriate listening address. The host runs the simulation and must keep its tab open; all guests need access to the room service and assets. A raw remote HTTP address lacks the secure browser APIs needed for hosting. Localhost is suitable for local testing.

Connection choices:

- **Automatic:** WebRTC first, relay fallback after ten seconds.
- **Relay:** the room service forwards game traffic; useful for restricted browsers/networks.
- **WebRTC only:** direct data channels without application-relay fallback. Different networks can require TURN.

## Single-player offline and Chromebook settings

Connect once and use **Download offline game** in the lobby. The pack contains the client, authoritative server workers, both client/server game data, WebAssembly and the upstream offline RSA material. Each file is checked against SHA-256 before an atomic cache switch. Downloading is bounded to four requests at a time; a failed update keeps the last complete pack. The current development pack is about 29 MiB, separate from character saves.

After **Offline ready**, reopen the same site's `/coop.html` and choose **Play solo**. The original server can be stopped and the network disconnected. No signaling, STUN, TURN or multiplayer service is contacted for solo play. Use the same browser profile and origin (including port); a different address has different browser storage. Offline files must have been downloaded before losing connectivity. Guest/co-op sessions still require the room service.

The Chromebook defaults are low detail, 30 FPS, muted audio and **Fit window**. **Battery saver** selects 15 FPS; 30/50 FPS, audio, fit/original/125% sizing are saved per device. FPS/audio/size apply during play; graphics detail applies next session. These controls reduce rendering work without changing the worker's simulation timing. **Focus game** opens fullscreen; Escape or **Exit fullscreen** exits. Ctrl/Cmd+S saves when either the lobby or game has focus. Hiding the tab requests a checkpoint and lowers client rendering to 15 FPS; it does not guarantee a save before Chromebook sleep or pause the world.

The lobby shows browser usage/quota and persistence status. **Request persistent storage** asks the browser to protect data from automatic eviction; a browser may decline. **Install app** appears if Chromium offers installation; Chrome's app shortcut still needs a completed offline download. Clearing browser data or changing profiles removes local saves, even for an installed app.

**Remove game download** clears only LoreScape's offline Cache Storage entries, preserving the saved-world IndexedDB database. The original client also keeps an expendable `lostcity` IndexedDB asset cache; it is independent of saves and falls back to loading game files when cache writes fail.

## Saving and recovery

The host browser stores every party member's character in IndexedDB, with automatic checkpoints every 30 seconds and on logout. **Save now** acknowledges a committed checkpoint; **Save & end room** waits for the final save. Three snapshots are retained. **Download backup** also works during a session and can export an in-memory validated snapshot if browser writes fail. Failed saves are shown explicitly and do not replace the committed world. A second tab cannot host the same saved world. Saved worlds show their character names; the most recently played world is selected on reload. Rename worlds in the lobby; deletion requires typing the exact world name and removes all its recovery snapshots.

Reopen the saved world and log in with the same character names to restore progression. Supported shared state includes inventories, world variables, world tick and settings. NPCs, ground items and temporary scenery/script changes reset. An abrupt tab/browser closure can lose the last 30 seconds of progress.

End the session to select a world and **Export backup** or **Restore earlier save**. To transfer a world, import its JSON backup on another browser, review the character count, and confirm. Imports default to a new world; replacing a matching world is explicit and retains prior snapshots. Damaged or incompatible archives are rejected. Clearing browser storage requires an exported backup to recover.

## Settings

Hosts can choose XP ×1/2/5/10 and NPC loot quantity ×1/2/3/5. Loot quantity affects tradable NPC death drops, not rare-drop probability. Any party member can pick up shared drops; stackable items form stacks, while non-stackable items remain separate ground objects. Sharing does not create a copy for every player. Original ownership retains the engine's usual rules. Settings apply in the game worker and are saved before the lobby acknowledges success.

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `LORESCAPE_PORT` | HTTP/WebSocket port; default 8080. |
| `LORESCAPE_BIND` | Listen address; default 127.0.0.1. |
| `LORESCAPE_ICE_SERVERS` | JSON array of browser RTCIceServer objects. Default Google STUN; use `[]` for local-only ICE, or configure authenticated TURN. Values are supplied to room participants. |
| `LORESCAPE_ORIGINS` | Comma-separated extra allowed browser origins. Same-origin requests work by default. |
| `LORESCAPE_SERVER_DIR` | Dedicated server checkout; default ignored `.local/server`. Its exact revision is checked. |

Setup updates the dedicated server checkout's dependency manifests from the pinned lock to install missing esbuild; use a checkout without manifest edits you need to retain. Revision and dependencies live in `tools/coop-config.mjs` and `tools/locks/server-package-lock.json`. Generated assets, saves and checkout remain ignored. The bundled offline RSA key is upstream offline-mode material. The upstream public friends backend and monitoring service are disabled.

## Development and checks

```sh
npm run build:coop    # Rebuild the co-op client and static lobby
npm run bundle:coop   # Rebuild worker adapters from already-packed server data
npm run test:session  # Room lifecycle, identity, settings and persistence validation
npm test -- --runInBand
npx tsc --noEmit
```

Start `npm run coop` before browser checks. Install Playwright/Chromium separately or point to an existing installation:

```sh
npm run test:coop
npm run test:storage
npm run test:offline
npm run test:production
```

`LORESCAPE_PLAYWRIGHT_PATH` selects the Playwright module directory; `LORESCAPE_CHROMIUM_PATH` selects its executable; `LORESCAPE_TEST_URL` defaults to http://localhost:8080. The smoke test requires the development `build:coop` output and instruments responses only for tests. It exercises four independent browser profiles, full-room rejection, duplicate hosting, settings, autosave, slot reuse and progression after restart. The offline test uses an isolated static server, stops it completely, blocks the network, and verifies solo login/restart, cache failures, quota recovery, fullscreen and device controls. `LORESCAPE_TRANSPORT=rtc` selects WebRTC instead of the default relay; `LORESCAPE_SMOKE_HOST_ONLY=1` limits it to host startup/login.

The production check builds a separate optimized client under `.local/production-client`, then verifies the lobby/worker API, device preferences, login and saving without replacing the development pack. Running sessions in any tab block offline asset updates and removal until those sessions end.

The managed cloud browser blocks local WebRTC ICE candidates. Relay tests do not establish WebRTC or cross-network connectivity; validate those on suitable devices without changing managed policies. No public service is deployed by these commands.

See [implementation](COOP-IMPLEMENTATION-PLAN.md) and [verification](COOP-VERIFICATION.md).

See [the code audit](CODE-AUDIT.md) for fixes, scope and remaining limits.
