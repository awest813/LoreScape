# Build and host the web app

The browser runs the game simulation. Node serves assets and, for co-op, the private room WebSocket service. Java and the historical server checkout are needed to build the game packs, not to run the finished website.

## Fresh checkout

Use Node 22+, npm, Git and Java 17+:

```sh
npm ci
npm run setup:web
npm start
```

Open http://localhost:8080/coop. Setup installs and packs the pinned compatible server; `build:web` creates the optimized client, browser workers and game data in `dist/`. A repeated `npm run build:web` rebuilds from the prepared server content. `npm run coop` continues to serve development assets from `public/`.

The production package is built in a staging directory. Every offline asset is checked by SHA-256, byte length and manifest revision before the previous `dist/` is replaced. Unused editor packs are excluded. Browser player saves, development checkouts and dependency directories are excluded. The offline engine's upstream RSA material remains part of its required game pack. Failed builds preserve the last complete package; `npm start` also validates it before listening, including the archive CRC table used during character login.

## Static solo hosting

```sh
npm ci
npm run setup:server
npm run build:web:solo
```

Upload the **contents** of `dist/` to an HTTPS static host at the domain root or a subdirectory. This build uses the polished solo launcher from `src/solo/`; room controls are hidden. Saves and the simulation remain in the player's browser. No Node room service is required. `index.html` redirects to the adjacent `coop.html`; the game iframe uses `index.html?world=999`. On hosts without extensionless HTML routing, use `/coop.html` directly. Configure `application/wasm` for `.wasm`, JavaScript MIME types for `.js`/`.mjs`, and avoid SPA fallback rewrites for missing asset URLs. Serve `offline-sw.js` and HTML with revalidation/no-cache rather than permanent caching. Solo assets, the app manifest and service-worker caches are scoped to the deployment directory. Separate installations on the same origin keep their offline file caches separate.

You can test the same solo package with `npm start`; it serves the launcher aliases `/coop`, `/coop/` and `/coop.html`, and does not start a room service. The existing ChatGPT Site remains owner-private. Its solo launcher is mirrored in `src/solo/` for self-hosting; the shared storage/protocol modules come from `src/public/coop/`.

## Node hosting with private four-player rooms

Build with `npm run build:web`, then run the repository's hosting tools with the resulting `dist/`. On a runtime machine, install dependencies with `npm ci --omit=dev --ignore-scripts`; Java and the server checkout are unnecessary there. Keep `package.json`, `package-lock.json`, `tools/`, `src/public/coop/protocol.mjs` and `dist/` from the same source version (the signaling service imports the protocol validator).

```sh
LORESCAPE_BIND=0.0.0.0 PORT=8080 npm start
```

`LORESCAPE_PORT` takes precedence over the platform's `PORT`; the default is 8080. Binding defaults to `127.0.0.1`. `/healthz` returns HTTP 200 after startup validation. SIGINT/SIGTERM closes room connections and stops the server. Keep one Node instance for rooms: room state is in memory, and restarting it ends those connections while browser saves remain.

Put HTTPS in front of Node and forward WebSocket upgrades to `/signal`. For example, with Caddy on the same machine:

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Use your real domain and the host's access controls for a private site. Remote plain HTTP lacks the secure browser APIs needed by the game; localhost is suitable for testing. A static host alone supports solo play. Four-player rooms require the Node service, and the host player must keep the game tab open.

Same-origin WebSockets work by default. `LORESCAPE_ORIGINS` allows comma-separated extra browser origins when intentionally hosting the UI separately. `LORESCAPE_ICE_SERVERS` accepts RTCIceServer JSON for STUN/TURN; the relay transport works through the same Node service when direct WebRTC is unavailable. See [COOP-SETUP.md](COOP-SETUP.md) for saves, room limits and settings.

## Verification

```sh
npm run test:session
npx tsc --noEmit
LORESCAPE_PRODUCTION_DIR=dist node tools/tests/browser-production.cjs
```

For an existing `dist/`, run `node tools/tests/browser-production.cjs` with `LORESCAPE_PRODUCTION_DIR=dist` and the running server's `LORESCAPE_TEST_URL`. Set `LORESCAPE_PLAYWRIGHT_PATH` and `LORESCAPE_CHROMIUM_PATH` if the browser test dependencies are installed elsewhere. The test instruments only its browser response, then verifies optimized-client login, device settings, world loading and character saving. Browser profiles/origins own saves; changing hostnames does not transfer them. Export backups before moving a game to another origin.

## Offline download and portable saves

In the solo launcher, **Install cache & play offline** downloads the complete package and enters a local character automatically. **Play offline** resumes it on later visits. For updates without starting play, open **Display, audio & offline settings**, then **Download offline game** while connected. The verified game pack stays in that browser profile; progress shows a percentage, file count and downloaded size. Cancellation, failed verification and full storage retain the previous pack. End active games in every tab before updating or removing offline files. Offline game removal keeps character saves.

Export a world backup from the saved-world controls or during a session. Its filename includes the world name and UTC timestamp. Import the JSON backup on another browser/device to move your progress. Keep these files outside the browser: clearing browser data removes both local game downloads and local saves. A previously installed service worker updates through the browser lifecycle; close all LoreScape tabs and reopen after an app update to activate the newest download controls.

Download regression checks against a completed optimized solo build:

```sh
node tools/tests/browser-downloads.cjs
```

Set `LORESCAPE_PLAYWRIGHT_PATH` and `LORESCAPE_CHROMIUM_PATH` when Playwright/Chromium are installed outside the normal module or browser paths. The check starts an isolated local server, downloads the entire pack, injects update/cancellation/storage faults, stops the server, logs into the offline world, saves a character, and validates exported backups and restore.

## GitHub Pages launcher with one-click offline installation

The deployment workflow prepares Java and the pinned server checkout, builds the normal launcher, then runs `npm run build:offline` to place the complete solo package under `public/offline/`. Pages serves these static assets; the game simulation runs on the user's device. The main install link opens `offline/coop.html?install=1`, installs and verifies the complete pack, then starts a local world and character. The query flag is removed so reopening the bookmark never silently starts another download.

The workflow checks all offline assets and runs `test:install-offline` in Chromium before publishing. No player saves or runtime state are bundled. The bundled upstream offline-mode RSA material is needed by the browser's private engine; it is independent of production server keys.

After a successful Pages installation, a small parent-scope worker redirects offline navigation at the usual launcher address to the installed solo launcher. It does not intercept game/tool asset requests and preserves an existing independently configured parent worker. The complete game still uses its own narrower scope. Keeping the direct offline-launcher bookmark also works when a host blocks the parent fallback.
