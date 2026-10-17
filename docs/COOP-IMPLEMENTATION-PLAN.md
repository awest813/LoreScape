# LoreScape private four-player implementation plan

Use the existing Client2 game and browser worker as the baseline. Build the session layer around it before changing combat, skills, quests, or progression. Four players means one host character plus three guests.

## Verified repository findings

| Source | Finding | Decision |
| --- | --- | --- |
| [2004Scape/Client2](https://github.com/2004Scape/Client2) | Archived March 17, 2025. LoreScape already matches its final commit, `43473be3faaab6e0564ca1a3ca51fbe729bdf66f`. | Develop in LoreScape; keep this upstream revision as the reference. |
| [2004Scape/Server](https://github.com/2004Scape/Server) | Archived October 14, 2025. Its final commit, `647886c42f8a22c0f18e5dbe79c2697f052f8d2e`, removes the documented browser bundler. | Pin an older server and its dependency lock; do not track HEAD for this baseline. |
| [Pinned server revision](https://github.com/2004Scape/Server/tree/c9a041799e9893a3174be433ca884837254f262b) | December 24, 2024 revision retains `worker.ts`, browser save loading, and the pre-refactor login protocol. December 26–27 changes introduced a different worker name and Node-only login file access. | Use `c9a041799e9893a3174be433ca884837254f262b` with the browser adapter under `tools/`. |
| [LostCityRS/Server](https://github.com/LostCityRS/Server) | Not archived at verification time. The old Server README redirects continuing work there, with engine/content separated. | Evaluate upgrades after the pinned browser baseline is reliable; treat this as a migration, not a compatible replacement. |

## Implemented milestones

| Phase | Implementation | Validation |
| --- | --- | --- |
| 1. Compatible baseline | Pinned server and dependencies, packed original game content, browser workers/WebAssembly adapters, one-command setup. | Server packing, client builds, host login and scene loading pass. |
| 2. Private lobbies | Eight-character room codes, authenticated host actions, automatic SDP/trickle ICE exchange, configurable ICE servers, optional WebSocket game relay. | Room-service tests and four independent browser profiles. Pure WebRTC still requires validation in a browser allowing ICE candidates. |
| 3. Four-player lifecycle | One host plus three guests; reservations count toward capacity; worker admission; packet validation and identity binding; kick, leave, logout and rejoin cleanup. | Fifth-player rejection, slot reuse, forged-ID rejection, negotiation expiry and host closure checks. |
| 4. Reliable saving | Host IndexedDB, worker storage acknowledgments, 30-second checkpoints, logout saves, three checksummed snapshots, export/import and recovery. Web Locks prevent two tabs hosting the same world. | Native-browser storage fault/recovery checks and in-game character/world restart checks. |
| 5. Co-op interface | Create/join lobby, party status, host removal controls, save status and recovery controls. Original game interface retained. | Browser integration exercises the controls. |
| 6. Progression options | XP ×1/2/5/10; tradable NPC death-drop quantities ×1/2/3/5; original or shared loot ownership. Settings validated in the worker and persisted. | Worker XP/loot assertions and setting restoration. |

## Architecture and persistence contract

The host browser runs the authoritative game worker. Guests use world 998; the host uses world 999, both launched within `/coop.html`. The room service handles invitations and signaling. In relay mode it also forwards authenticated game packets; it never simulates the world or stores character saves. Automatic mode tries WebRTC and requests relay after ten seconds if negotiation has not completed. WebRTC-only mode does not fall back. STUN/TURN are configurable.

Guest IDs supplied in packets are discarded and replaced by the reserved connection ID. The room service, host transport and worker independently enforce the four-player boundary. Codes are private invitations rather than accounts: use trusted friends and distinct character names. An established connection loss requires leaving/rejoining; there is no host migration. Pending negotiations expire after 45 seconds and rooms after eight hours.

Persisted state comprises the engine's permanent character save bytes (including XP, permanent inventories, character variables and position), shared inventories including exhausted shop stock, world integer/string variables, world tick and session settings. NPCs, ground items, changed scenery and temporary script queues restart from the original map. This is an explicit persistence contract, not a full serialization of every engine entity. Shared tradable drops are claimable by any player, with the engine's original stacking rules; they do not create separate copies per party member. Loot quantities change only tradable drops executing within audited NPC death scripts (`ai_queue3`), not rare-drop probability or quest rewards.

Host writes are serialized and committed atomically. SHA-256 snapshot checksums and original character CRCs detect damaged records; loading falls back to an earlier valid snapshot. The recovery control rolls back to an earlier valid snapshot, and import validates a preview before optionally replacing a matching world. Clearing browser storage loses local saves unless an exported backup exists. Abrupt shutdown can lose progress since the last committed checkpoint; graceful room closure waits for a save.

## Build compatibility

The archived bundler required local adapters for the browser worker factory, pathfinder WebAssembly loading, Node monitoring/color dependencies and an import-removal rule that accidentally removed the WebAssembly imports object. Local `tools/` plugins adapt the pinned server at build time, with checked replacement markers; upstream sources are not edited for gameplay changes. The public friends-service worker is a no-op in this private build; local game chat remains available.

## Offline and device follow-up: implemented

The follow-up audit adds solo sessions independent of signaling, a verified offline asset pack and app metadata; device-specific low/high detail, 15/30/50 FPS, persistent mute and game scaling; fullscreen and save shortcuts; visibility checkpoints; storage estimates/persistence requests; saved-character summaries, remembered world selection, world rename and guarded deletion; and in-session emergency backup export.

Storage hardening includes immutable commit identities, safe character dictionary access, full v5 character framing validation, duplicate-inventory rejection, shared database-open handling and version-change cleanup. Expendable client asset-cache writes can fail without aborting game loading. Transport closes overloaded streams rather than silently discarding bytes and rotates identity for each room admission. See [the audit](CODE-AUDIT.md).

Offline play remains one authoritative local world with the documented persistence contract. Installation is local browser functionality, not deployment. Chromebook window dimensions are tested in Chromium; physical Chromebook performance and OS sleep behavior still need device checks.

## Remaining external acceptance

Run the four-player smoke test using `LORESCAPE_TRANSPORT=rtc` on a machine whose managed browser policy allows WebRTC, then test two physical devices and separate networks with configured TURN if necessary. This workspace's Chromium policy prevents local ICE candidates, so four-player integration is validated through the application relay instead. No public hosting, Internet connectivity claim, host migration, or full-world serialization is included.

See [setup](COOP-SETUP.md) for launch/configuration and [verification](COOP-VERIFICATION.md) for results. Retain upstream provenance/licenses; software licenses and game asset/content redistribution rights are separate.
