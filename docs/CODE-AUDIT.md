# LoreScape browser integration audit and polish

Audited October 11, 2026. Scope: the active co-op/session layer, browser worker adapters, persistence/import paths, client asset cache, device rendering/audio controls and offline delivery. This is not a security certification or an exhaustive audit of the archived game's combat, scripts or every upstream editor tool.

## Findings resolved

| Finding | Resolution and evidence |
| --- | --- |
| Queued commits used mutable world ID/name after capturing snapshot bytes. | Capture the complete data object at enqueue time and use that immutable identity throughout the transaction. Native browser tests mutate the caller's ID while a write is queued. |
| Character dictionaries could read inherited properties or lose prototype-shaped names. | Own-property reads and explicit own-property writes. Tests cover `constructor` and `__proto__`; the offline gameplay test logs in as `constructor`. |
| A checksum-valid import could still contain malformed character framing. | Validate v5 lengths, variable/inventory sections and trailing bytes before passing a save to the engine; reject truncated data, invalid capacities and duplicate shared-inventory records. |
| Played-world backups could export sparse string slots as JSON `null` and fail to import. | Serialize dense empty strings and explicit empty inventory slots. Normalize legacy empty string slots only after verifying the original checksum. Regression tests preserve input immutability and reject tampering and numeric string values; persona gameplay tests exercise live backup transfer. |
| Failed storage writes could leave UI state ahead of committed data. | Commit a candidate snapshot before replacing session data. Preserve failed character updates across retries and keep a candidate for checked emergency export; quota failures remain visible and do not end play or pretend a save succeeded. |
| Concurrent IndexedDB opens/version changes could retain obsolete handles. | Share opening promises, close on version change, and close an eventual blocked-open result. Keep writes transactional and retain three checksummed snapshots. |
| Expendable asset-cache write failures stopped game loading. | `lostcity` cache read/write failures fall back to game files. Character saves use a separate acknowledged database and still report failure. Offline tests deliberately reject every legacy asset-cache write. |
| A slow relay receiver could silently lose ordered game bytes. | Terminate overloaded streams and clean up admission rather than dropping individual packets. Rotate connection identity on each room admission to separate late negotiation messages. |
| Solo play depended on live room signaling. | A local session owns its worker and saves without opening a WebSocket or constructing guest peer connections. The offline test's server has no signaling and is stopped before play. |
| Offline caching could miss server scripts/maps or key material. | Generate a hashed allowlist of both packed client and server data, browser runtime files and upstream offline RSA material. No player saves are published or cached as assets. |
| Updating an incomplete pack could break offline readiness. | Stage/verify each file, then switch the active pointer; preserve the previous complete pack on error. Bound download concurrency to four and enumerate cache keys for readiness rather than doing thousands of sequential lookups. Cache the manifest in worker memory during gameplay. |
| Browser fatal-error paths called Node `process.exit`. | Build-time browser adaptation throws an error instead; packed-file reads check HTTP status before parsing binary content. |
| Frame limiter accepted zero and the iframe manifest URL could contain a double slash. | Clamp frame targets above zero and resolve manifest URLs using `URL`. |
| A character rejoining after a failed logout save could load older committed progression. | Serve pending, validated character bytes while storage is unavailable. The browser quota test verifies loading the newest pending XP before retrying the commit. |
| Another tab could remove or update offline assets during a game. | Game sessions hold shared Web Locks; offline mutations take an exclusive lock in the service worker. Removal is also serialized with downloads. The offline browser test checks a second tab cannot remove a running game's files. |
| Button completion could override disabled states; late saves could update a different session's UI. | Preserve readiness, selection and persistence rules after actions. Keep save feedback scoped to its session, wait for queued writes before refreshing saved worlds, and ignore stale world-detail results. |
| Delayed signaling or worker messages from an ended session could affect the next session. | Close and detach ended-room sockets, ignore obsolete socket/worker callbacks, and disconnect any idle room socket before solo play. Multiplayer checks cover immediate room-to-solo switching. |
| Production property mangling could rename APIs used by unbundled lobby modules and worker messages. | Preserve property names across minification. The optimized-client browser check verifies device preferences, login, scene loading and character persistence. |
| The multiplayer persistence fixture used shop stock, which changes during normal restocking. | Select a non-restocking shared inventory so the test measures persistence independently of shop simulation. |

## Polish and quality of life

- Offline single-player start, local app manifest/icon and an installation control when Chromium offers it.
- Chromebook defaults: low detail, 30 FPS, muted audio, fit-to-window. Battery saver uses 15 FPS. Device preferences persist independently of world progression.
- Live FPS/audio/scaling changes, original/large pixel sizes, fullscreen, and Ctrl/Cmd+S while the game has focus. Graphics detail applies next session.
- Checkpoint request on tab hiding, with reduced background client rendering. Worker simulation remains authoritative and is not paused or sped up.
- Storage usage/quota/persistence status, explicit persistence request, remembered world selection and saved-character summaries.
- World rename; deletion requires typing its name. Recovery, previewed imports, and live backup download remain available.
- Offline-file removal is separate from character saves. The disposable legacy asset database can retain rebuildable files independently.

## Validation and limits

The room/validation tests, native IndexedDB fault/recovery tests, four-player integration and offline integration accompany this audit. The offline test verifies the complete download, failed-update retention, true server-stopped/network-blocked play, character restoration, failed asset-cache writes, fullscreen/device preferences, quota recovery/emergency export and deletion without losing other saves.

Repository-wide TypeScript lint and type checking pass. Development, optimized co-op client, and full production builds across all nine client/editor entry points pass; production builds retain webpack's size advisories. The dependency advisory lookup did not complete in this environment; no claim of an advisory-free dependency tree is made.

Actual Chromebook hardware performance, ChromeOS sleep behavior and OS-level app installation are not validated here; device controls are exercised in Chromium at laptop/window dimensions. Persistent-storage grants depend on browser policy. Offline mode requires a completed download on the same origin/profile and cannot protect against clearing all browser data. Export backups.

The persistence contract remains permanent character data, shared inventories, world variables/tick and settings. NPCs, dropped items and temporary scenery/script state reset. No host migration, cross-network WebRTC claim, engine/content migration or public deployment is included. See [verification](COOP-VERIFICATION.md) and [setup](COOP-SETUP.md).
