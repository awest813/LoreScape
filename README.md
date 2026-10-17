# LoreScape

A browser client and collection of cache tools based on the [2004Scape TypeScript client](https://github.com/2004scape/Client2), a source port of the 2004 client refactor.

The launcher provides a live world directory with free/member filters, remembered world and graphics choices, a toolkit, and connection guidance. The game client loads only when you select **Enter world**. Existing `?world=…&detail=…` links still launch directly. A separate client view provides fullscreen, loading progress, recovery messages, and a route back to the launcher. Game files and live worlds come from the 2004Scape services. **Public worlds use separate servers. The offline solo option runs its own private game simulation inside your browser.** Availability, account requirements, membership, and cross-origin access are controlled by the selected server.

Choose **Install cache & play offline** on the launcher for a complete private game. The first connected download is about 28 MiB; it includes the client, game data and browser server workers. Installation verifies every file, then opens the first saved local character (or creates `adventurer`). Bookmark the launcher; after installation its usual address also falls back to the offline launcher when disconnected. On later visits, **Play offline** resumes your saved world with no account or external server. Public-world characters are separate. Browser storage and service workers must be allowed; export backups before clearing site data. Installing an app shortcut is optional.


## Develop locally

For a downloadable launcher **and game server**, use [Local server setup](https://awest813.github.io/LoreScape/local-setup.html). Extract the ZIP, run `node setup.cjs`, then `node start.cjs`; open `http://127.0.0.1:8080/` after the server reports ready. Requires Node.js 22.22.1+, Git, Java 17+ and internet during initial setup. This installs pinned upstream server revision `647886c42f8a22c0f18e5dbe79c2697f052f8d2e` using a tested dependency lockfile, generates a private installation key, and proxies the launcher/files/WebSocket through one browser origin. The server is a private development world with automatic saves and no account authentication; use throwaway credentials. Setup preserves existing settings and saves. Native package installation may require build tools.

**Managed Chromebooks without Linux support cannot install that server.** Use a permitted public world, or host the kit on another computer behind HTTPS and open its hosted launcher on the Chromebook. The [Chromebook guide](https://awest813.github.io/LoreScape/local-setup.html#chromebook) and ZIP README include a Caddy example. Cache viewer/JagEd remain browser tools: open a classic cache ZIP or extracted folder without installing a server, subject to device policies. No software here can override an administrator's website, WebSocket, download or file-import restrictions.

`npm run build` generates `public/lorescape-local-server.zip` from the current emitted assets and `scripts/local-server/`. The ZIP includes the built client and installer, not a preinstalled/offline backend. `node setup.cjs` retrieves the upstream MIT-licensed source from GitHub, restricts its web/management/TCP listeners to loopback, and installs its dependencies. For a production community server, configure upstream authenticated accounts; do not publicly expose the kit's development backend or private files.

The kit pins bcrypt 6.0.0 and Kysely 0.28.17 to remove the legacy native installer/tar chain and SQL-builder advisories. The October 17, 2026 production dependency audit still reports one unpatched high-severity node-forge signature-verification advisory (GHSA-86w9-cpqp-85rv). The server's node-forge calls parse keys and perform RSA arithmetic, rather than verifying signatures; the dependency advisory remains documented in the setup guide and ZIP README. This private development kit is not a hardened public account service.

Use Node.js 22.22.1 or newer (`nvm use` selects the latest Node 22 release):

```sh
npm ci
npm run dev
```

Open `http://localhost:8080/`. The launcher starts with live world 1 selected. Choose a world and select **Enter world**, or launch directly with `?world=1&detail=low&method=0`. Low detail is useful on slower devices. Desktop keyboard and mouse are recommended; the canvas scales to smaller screens.

Open **Local & browser worlds** to select one of these modes:

| Mode | Requirements |
| --- | --- |
| Local server (0) | A separately running compatible revision 225 server. Set **Server web address** to its HTTP/HTTPS origin and web port (default `http://localhost:8888`; use `http://localhost` for port 80). |
| Host in browser (999) | A compatible `worker.js` ES module and its dependencies beside `index.html`, plus matching `data/pack/client/` game data. External clipboard-mode bundles must be supplied separately. The Pages offline solo package is installed through **Install cache & play offline**. |
| Join a host (998) | Matching `data/pack/client/` game data on this website, WebRTC support, and a running browser host. |

For an HTTP local server, run `npm run dev` and open `http://localhost:8080/`. HTTPS Pages requires an HTTPS/WSS server with a trusted certificate. The server must allow downloads from the launcher origin (CORS), accept WebSocket connections from it, and use RSA keys compatible with this client. The launcher tries WebSockets on the configured web port first, then the legacy port 43595. The server address is remembered on this device. Pending local checks can be cancelled; changing the world, address, or graphics cancels the old check before it can launch. A direct link looks like `?world=0&local=http%3A%2F%2Flocalhost%3A8888&detail=low`.

Browser modes check for required resources before loading the game. Installed LoreScape room bundles route Host/Join to their saved-world and room-code lobby. Relay and Automatic joining can use the room service when WebRTC is unavailable or blocked; both browsers still need an allowed WebSocket connection. Packed client data must include a 36-byte `crc` table and the matching `title`, `config`, `interface`, `media`, `models`, `textures`, `wordenc`, and `sounds` archives; provide `songs/` for music. Copy any external bundles into `src/public/` before building, or into the served `public/` directory for a temporary local preview. Files added only to `public/` will not be included in CI deployments. Use the **New user** button on the login screen to exchange the host offer and guest answer; while logged in, a host can type `::peer`. Clipboard access has a manual copy fallback, and Cancel stops the invitation. External clipboard peers use direct WebRTC without a TURN relay. LoreScape room-code sessions can use the hosted WebSocket relay on restricted networks.

Check your local server without sending credentials:

```sh
npm run check:server -- --local http://localhost:8888 --origin http://localhost:8080
```

If startup fails, the status panel now shows the failed endpoint and error. A failed CRC request usually means the server is stopped, the web port is wrong, or browser access is blocked by CORS/mixed content. An HTML response at `/crc` means the URL points at a website rather than the game file service. Browser cache is optional for gameplay; unavailable, closed, or stalled storage falls back to server downloads. Cache viewer and JagEd accept a classic cache ZIP, a cache folder, or individual files. ZIP/file drag-and-drop is also supported. ZIP/folder imports validate the complete set before saving it together, and the saved cache loads automatically when the tool reopens. When site storage is blocked, the tools keep imports in memory for the current tab and explain that reloading requires selecting the cache again. Imports report progress, unsupported files, and storage failures. Imported files stay in your browser. ZIP/folder imports support stored or DEFLATE-compressed ZIPs up to 128 MB of cache data; extract split/ZIP64 archives before selecting their folder. Game archives are checked against their advertised length and CRC before decoding or caching; mismatched or HTML responses name the failed archive in the status panel.

## Download a cache on Chromebook

In the launcher, choose a world (or configure **Local server**), open **Download cache for Chromebook**, and leave **Classic cache for Cache viewer / JagEd** selected. Click **Download classic cache (.zip)**. After downloading, open **Cache viewer** or **JagEd** and choose the ZIP directly with **Open cache ZIP or files**. Alternatively, extract it in **Files → Downloads** and use **Open cache folder**. The tool finds all six `main_file_cache.dat` and `.idx0`–`.idx4` files automatically, including a cache nested inside a folder. Your saved cache loads automatically on later visits; choose the folder/ZIP again when you want to update it. No terminal, extension, or Linux container is needed. Downloads and model conversion can be cancelled.

The exporter verifies the selected server's eight revision 225 archives, writes them into classic cache sectors, and converts its models into the format read by these tools. The ZIP includes a README. Animation, music, and map stores are empty; this is a model inspection cache for LoreScape tools, not a complete revision 317 game cache or an offline game server. The file server must be reachable and permit browser downloads (CORS). Failed or cancelled exports produce no ZIP. Classic cache data is limited to 64 MB.

For browser server bundles, select **Core browser client files** instead. That ZIP contains the eight startup archives and `crc` table under `data/pack/client/`; use Classic cache for Cache viewer and JagEd.

## Validate and build

```sh
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
npm run check:pages
```

For launcher browser regression checks, run `npx playwright install chromium`, then `npm run test:launcher`. To use an existing Chromium installation, set `LORESCAPE_CHROMIUM_PATH` to its executable instead. The checks serve the built website locally and use fixture world services; they do not contact public game servers.

See [browser performance and compatibility](docs/BROWSER-PERFORMANCE.md) for frame pacing, background tabs, browser requirements, and verification limits.

The build compiles the Bzip2 WebAssembly module and writes the website to `public/`. It uses relative asset paths, so the same build works at `/LoreScape/`, at another repository path, or on a root/custom domain. JavaScript and CSS use content hashes and shared chunks. Keep the generated HTML, JavaScript, CSS, WebAssembly, soundfont, manifest, and icons together.

To preview production locally, run `npm run preview` after building. To test the exact generated files with any static HTTP server, serve `public/`; do not open the HTML using `file://`.

`public/` is generated and ignored by Git. Save source edits in `src/`. The Pages workflow builds the pinned solo server package into `public/offline/` on every deployment; external clipboard-mode bundles still need separate provisioning; never publish player saves or credentials.

## Audit limits

Production dependencies currently have no known npm advisories. The development dependency tree retains 25 advisories (5 high, 20 moderate), rooted in unpatched releases of `braces` and `sprintf-js`. Critical findings from the original lockfile have been resolved. Review `npm audit` as upstream patches become available; the development server is not part of the Pages deployment.

The build succeeds with Sass deprecation warnings from the legacy Foundation styles and bundle-size warnings. A future Sass migration remains necessary. Automated browser checks use controlled world-service responses; live login and gameplay require verification against the selected external server from the deployed origin.

## Deploy to GitHub Pages

1. In the repository, open **Settings → Pages → Build and deployment**, and select **GitHub Actions** as the source.
2. Push these changes to `main`, or run **Validate and deploy GitHub Pages** in the Actions tab on `main`.
3. The workflow installs from the lockfile, runs lint, type checking and tests, builds the site, validates the generated assets, then uploads and deploys the Pages artifact. Pull requests run the same validation without deploying.
4. Once the deployment succeeds, open `https://awest813.github.io/LoreScape/`. Check a direct link such as `index.html?world=1&detail=low`, the tool links, and the manifest. Use the deployment job's URL if the repository name, owner, or domain changes.

If you previously deployed from a `gh-pages` branch, selecting **GitHub Actions** replaces that deployment source. No PAT, custom deploy key, or manually committed build output is required. Repository or organization settings may require an environment approval for the `github-pages` environment.

## Pages and controls

| Page | Purpose |
| --- | --- |
| `index.html` | Launcher and on-demand game client |
| `playground.html` | Interactive model viewer |
| `items.html` | Item list and search |
| `sounds.html` | Sound viewer and playback |
| `mesanim.html` | Chat message animation editor |
| `mapview.html` | World map viewer |
| `viewer.html` | Cache viewer; load your own cache files |
| `interface-editor.html` | Interface editor (experimental) |
| `JagEd.html` | Cache editor (experimental) |

Click or Tab to the canvas to use the keyboard. In model/cache viewers, use arrow keys to rotate, W/S to zoom, R to reset, and `[` / `]` to adjust movement. Game commands include `::debug` for performance metrics, `::chat` for chat font eras, and `::fps 30` for a frame-rate target.

## Connection troubleshooting

- If loading fails, check your connection, use **Reload and retry**, or choose another world. World-list requests have a 10-second timeout and at most three attempts. File downloads time out after 30 seconds; archive requests also have bounded retries.
- Live world services must support HTTPS and permit requests from the deployed site's origin. The website cannot override a server's CORS settings or host a WebSocket server on Pages.
- Cache tools that download game files need the same services. Cache viewer and JagEd let you load cache files from your computer. Some tool data also comes from the upstream server repository on GitHub.
- The main manifest provides app metadata. The separate `offline/` package has its own scoped service worker and verified game-data download; public worlds still require network access.
- If a deployment fails, inspect the first failing Actions step. Asset checks detect missing files, invalid Bzip2 WebAssembly, and root-relative asset paths that would break project hosting.

## Attribution

Based on 2004Scape Client2 and its contributors. This is an independent community project, unaffiliated with Jagex. RuneScape is a trademark of Jagex Ltd. The original project identifies its client code as a TypeScript source port; retain upstream attribution and review rights for any game assets you distribute.


## Verify a game server connection

Run the transport check from a network that can reach the selected game server:

```sh
npm run check:server -- --world 1 --origin https://awest813.github.io
```

The check uses the same endpoint resolver as the client. It checks the world directory, CORS for the deployed site's origin, the 36-byte game-file CRC table, and a real binary WebSocket handshake. It honors HTTP/HTTPS proxy and NO_PROXY settings. It sends no account credentials or login packet. A successful transport check does not verify account authentication, the server's RSA key, or gameplay.

For your own deployment, set `WORLD_LIST_URL` in `src/js/connection.ts` to your world directory, rebuild, and use `--directory https://your-server.example/worlds` when running the check. Each world needs `id`, `address`, `portOffset`, `region`, and `players`. An optional `websocketAddress` such as `wss://game.example/play` selects an explicit socket endpoint. Without it, the client tries WebSockets on the advertised web endpoint first, then the legacy game port (`43596 + portOffset` for WSS, `43595 + portOffset` for WS). HTTPS worlds remain secure in local previews; Pages refuses insecure game endpoints.

Your backend must serve client revision 225 and matching game files and public RSA parameters, allow file downloads from the Pages origin via CORS, and accept that origin during WebSocket upgrades. The current Pages origin is `https://awest813.github.io`, without the `/LoreScape/` path. Current upstream servers can enforce `WEB_ALLOWED_ORIGIN` and deployment-cookie protection. A separately hosted client cannot bypass those checks; coordinate the backend configuration or co-host the client as required.

The development workspace used for this update blocks outbound access to `2004scape.org`, so public-world availability could not be verified here. The generic startup message alone does not identify the public-world failure; use the detailed status and browser network panel to distinguish directory errors, game-file errors, and browser restrictions. The official 2004Scape site is linked when a public world fails. Actual WebSocket connections and seed exchange are covered against local test servers, including fragmented frames, early disconnects, endpoint fallback, CORS failures, and timeouts.

## Private co-op and offline hosting

The merged co-op tools provide room codes, up to four players, automatic saves, portable backups, and complete offline game packages. See [co-op setup](docs/COOP-SETUP.md) and [web hosting](docs/WEB-HOSTING.md). Run `npm run setup:coop` then `npm run coop` for a local browser-hosted room, or `npm run setup:web` then `npm start` for a production package. These commands fetch and build a separate server; the GitHub Pages workflow additionally builds the solo package at `offline/`. Offline play requires an initial successful installation.

To reproduce the complete Pages deployment locally, run `npm run setup:server`, `npm run build`, then `npm run build:offline`. The last command writes only `public/offline/` and preserves the main launcher. Run `npm run check:pages -- --offline` and `npm run test:install-offline` (set `LORESCAPE_CHROMIUM_PATH` if using a system Chromium). The browser check clicks the main install link, verifies automatic character entry and saving, stops its static server, and checks the bookmarked launcher, gameplay and saving offline under `/LoreScape/offline/`.

The downloaded native kit forwards its offline-install link to the complete hosted solo package; the first installation needs access to that site. Its browser saves remain separate from the native server player files.
