# Build and hosting audit — October 11, 2026

The client-only upstream build did not produce a complete standalone game package. Hosting relied on optional CLI downloads, generated development assets, and relative launcher links that failed on `/coop/`.

Changes:

- `setup:web` packs the pinned compatible server and builds optimized `dist/`; `build:web:solo` produces a static solo variant with room controls hidden.
- Dedicated staging avoids stale generated files. The game asset allowlist excludes editor packs and runtime saves; SHA-256, sizes, manifest revision and required workers/WASM/packs are verified before replacing the last complete package.
- Production startup verifies the artifact, supports the platform `PORT`, provides `/healthz`, serves clean launcher aliases and WASM MIME types, and shuts down room connections on process signals.
- Solo mode does not start signaling. Co-op mode serves `/signal` from the same Node process; HTTPS proxy guidance is in `WEB-HOSTING.md`.
- Co-op webpack output uses root asset paths even under CI. Duplicate minifier/extraction plugins were replaced by one configured production minimizer, preserving cross-module property names and inline license comments.
- Query-based iframe routes remain intact. Static root navigation opens the launcher; offline clean-route aliases resolve the cached launcher. Test-only instrumentation supports both development and optimized clients.

Verified:

- Clean detached checkout with current source edits: `npm ci`, a new pinned server checkout, fresh dependency installation/content packing, then a complete production co-op build. Logs: ignored `.local/fresh-build.log`.
- Static solo production build: 2,788 checked assets, approximately 27.7 MiB; optimized client approximately 520 KiB. Logs: `.local/build-web.log`.
- TypeScript check and 11 session/storage/HTTP hosting tests passed. HTTP checks cover aliases, game queries, MIME/HEAD, missing assets, method rejection, traversal and symlink escape rejection.
- Real production room service: a host and three guests admitted, fifth player rejected; solo service rejects WebSocket room upgrades.
- Optimized client on both the new solo production host and the polished Site package: real world startup, login, device preference and character checkpoint passed without unexpected browser errors.

The deployment archives are ignored `.local/lorescape-web-solo.tar.gz` and `.local/lorescape-web-coop.tar.gz`. They contain `dist/` only. Co-op deployment also needs the Node source/runtime files documented in `WEB-HOSTING.md`. Standard webpack size recommendations remain; this legacy game engine intentionally ships a single client bundle. Physical-device and authenticated live-site gameplay are not independently automated.

The full polished launcher regression suite also passed with the optimized client: real movement and save/restart, mobile layout, fullscreen sizing/scroll locking, policy fallback, delayed approval/denial cleanup, and save-quota failure recovery.

Build validation used Node 24 and Java 21 in this workspace. The project declares Node 22+; the server setup requires Java 17+.

A clean-build gameplay check exposed an upstream packing-order defect: `CrcBuffer` was initialized before any client archives existed, so the first pack wrote 36 zero bytes to `data/pack/client/crc`. The worker computes real CRCs and rejects that client during login. Bundling now computes the nine-entry CRC table from the finished archives, and verification rejects stale tables even when their SHA manifest is internally consistent. A standard CRC-32 vector and changed-archive regression test cover this first-build path.

After correcting the CRC table, the fresh co-op package passed optimized-client world startup, real character login and committed character saving. The solo build mirrors the polished Site launcher from `src/solo/`, sharing the same storage/protocol/device modules as co-op.

The final polished solo `dist/` also passed optimized world startup, character login and committed saving on the production Node host. The production startup checksum guard accepted the finished package. Both hosting archives were regenerated after verification.
