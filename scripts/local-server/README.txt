LORESCAPE — LOCAL SERVER SETUP

This ZIP contains the built launcher and setup scripts. It downloads and starts
the MIT-licensed 2004Scape revision 225 server from GitHub at this pinned revision:
647886c42f8a22c0f18e5dbe79c2697f052f8d2e
Source and license: https://github.com/2004scape/Server
The first setup needs internet access; this is not an offline server archive.

WINDOWS / MAC / LINUX
1. Install Node.js 22.22.1 or newer, Git, and Java 17 or newer.
   Linux may also need Python 3, make, and a C++ compiler for native dependencies.
2. Extract the WHOLE ZIP into a writable folder (not inside another server).
3. Open a terminal in that folder. Run: node setup.cjs
   This installs dependencies and builds game/tool data; allow several minutes.
4. After setup completes, run: node start.cjs
5. Leave the terminal open. A start may rebuild changed game data.
   Wait for "World ready", then open http://127.0.0.1:8080/ in Chrome.
6. Select Existing user. For this private development world, a new name creates
   a save automatically. There is no account authentication in this local mode.
   Use a throwaway password, never a password from another service.

Later starts: node start.cjs. Stop with Ctrl+C. Do not close the terminal while
saving. Player saves live in server/data/players/. Back up that folder before
reinstalling. Re-running setup preserves .env, installation keys and saves.
Stop the server before re-running setup. The kit serves the launcher, files and WebSocket through one address, avoiding
cross-origin browser failures. It supplies the installation's PUBLIC login key
to its own client; private keys stay in the server directory. Built-in tools
connect to this local world automatically. Map and chat-animation data are built
during setup and served through specific read-only endpoints.
Ports: launcher 8080, server 8888, management 8898, game TCP 43594.
The installer restricts backend listeners to 127.0.0.1. Keep these ports private;
the upstream development world is not hardened for
public account hosting. No ports or firewall rules are opened by these scripts.

LOCKED-DOWN CHROMEBOOKS
A managed Chromebook without Linux support cannot install this local server.
Opening the ZIP or cache does not start a server. No browser extension or
administrator-policy bypass is supplied or needed for the browser tools.

Option A: use the online launcher and an available public world in Chrome.
The administrator must allow the website, game-file requests and WebSockets.

Option B: run this kit on another computer or a server, and open its hosted
launcher URL on the Chromebook. For access from an HTTPS website, use a trusted
HTTPS endpoint with WebSocket forwarding. One example for a host with a domain
and Caddy installed:

  Set LORESCAPE_PUBLIC_ORIGIN=https://play.example.com before node start.cjs
  (macOS/Linux: LORESCAPE_PUBLIC_ORIGIN=https://play.example.com node start.cjs)
  (PowerShell: $env:LORESCAPE_PUBLIC_ORIGIN='https://play.example.com'; node start.cjs)

  Caddyfile:
  play.example.com {
      reverse_proxy 127.0.0.1:8080
  }

Point the domain at that host, allow HTTPS for the proxy, and visit
https://play.example.com/ on the Chromebook. Caddy must run on the same host as
the kit. It forwards HTTP and WebSockets together. Keep the generated ?setup=1
launcher link; it selects the correct installation key. Do not publish the
server folder, private.pem, saves or .env. For a public community server, use
the upstream authenticated production setup instead of this development mode.
Managed networks may block custom hosts or games: an administrator must allow
the destination. Software on this page cannot override those policies.

CACHE TOOLS ON CHROMEBOOK
Cache viewer and JagEd run in Chrome without a game-server installation.
Use Download cache in the online launcher, then Open cache ZIP or files in the
tool. Or select the extracted folder with Open cache folder. Browser storage
remembers imports when allowed. If storage is blocked, imports work for the
current tab; reselect the ZIP after reloading. The classic cache contains model/tool stores, not a full
server. School policy can disable downloads or uploads too.

TROUBLESHOOTING
- Setup failed: read the first terminal error, check prerequisites/network and
  retry node setup.cjs. Native packages can require platform build tools.
- Address in use: stop the old instance or program using the named port.
- 503 / missing CRC: wait for World ready; inspect server errors in the terminal.
- Login out of date: open the root URL printed by start.cjs again. A different
  server or a link without setup=1 may use a different key.
- Public world unavailable: it is a separate service, not included in this ZIP.

The pinned server is an archived upstream snapshot. This kit supplies a tested
dependency lockfile and installs with npm ci. Package availability and platform
support can still affect installation. The source is included by Git
in server/ after setup, including its LICENSE. LoreScape is based on the
2004Scape TypeScript client: https://github.com/2004scape/Client2
Third-party bundle license notices accompany the client JavaScript files.

Dependency audit (2026-10-17): this kit pins bcrypt 6.0.0 to remove the obsolete
node-pre-gyp/tar installer chain and Kysely 0.28.17 to fix SQL-builder advisories.
node-forge still has an unpatched high-severity signature-verification advisory
(GHSA-86w9-cpqp-85rv). This local server uses it for RSA key parsing/arithmetic,
not signature verification. It remains an upstream dependency limitation;
do not treat this kit as an audited public production server.

The launcher's Install cache & play offline option opens the complete solo package on the LoreScape website. Its first installation needs an internet connection; later play uses that browser's cached files and private saves. Those saves are separate from this native server's player files.
