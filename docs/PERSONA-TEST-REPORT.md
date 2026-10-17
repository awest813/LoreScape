# Twenty gameplay sessions across eight player styles

Tested October 11, 2026 (UTC). All 20 distinct scenarios passed after fixes and targeted reruns. These are scripted Chromium gameplay sessions representing eight behavior profiles, not human testers or complete quest/game playthroughs.

| # | Player style | Scenario and verified result |
| --- | --- | --- |
| 1 | Newcomer | Keyboard login, character design and RuneScape Guide dialogue. |
| 2 | Newcomer | Name with spaces normalizes to `new_friend`; tutorial character survives restart. |
| 3 | Newcomer | Decline tutorial skip, continue guide dialogue and advance tutorial progression. |
| 4 | Explorer | Walk through Lumbridge; restart restores position `(3226, 3217)`. |
| 5 | Explorer | Load two map regions and walk on reachable tiles in each. |
| 6 | Explorer | Examine a tree, rotate the camera with the keyboard and click game tabs. |
| 7 | Skiller | Chop a real tree: logs and 25 woodcutting XP. |
| 8 | Skiller | Net fish at a real fishing spot: shrimp and 10 fishing XP. |
| 9 | Skiller | Mine a copper rock: ore and 17.5 mining XP. |
| 10 | Warrior | Kill a chicken, receive 12 attack XP and pick up its privately owned raw chicken drop. |
| 11 | Warrior | XP ×5 and shared loot ×3: 60 attack XP and three raw chickens picked up. |
| 12 | Warrior | Eat bread: injured hitpoints rise from 3 to 7 and food is consumed. |
| 13 | Social host | Host plus three guests log in; all three guests receive public chat. |
| 14 | Social host | Reject a fifth participant, kick one guest and log a replacement into the released slot. |
| 15 | Cautious saver | Export a played character, import into an independent browser profile and log in at its restored position `(3222, 3218)`. |
| 16 | Cautious saver | Inject a storage quota failure; show failure, export unsaved progress and recover saving. |
| 17 | Impatient clicker | Eight immediate launch clicks create one session; rate changes and five queued saves preserve the world. |
| 18 | Impatient clicker | Two room-to-solo transitions preserve character position. |
| 19 | Battery/keyboard player | Run at 15 FPS, send keyboard chat, save with Ctrl+S and enter/exit fullscreen. |
| 20 | Battery/keyboard player | Fit within an 800-pixel viewport; live 30 FPS/audio preferences survive restart. |

Allocation: three sessions each for Newcomer, Explorer, Skiller and Warrior; two each for Social host, Cautious saver, Impatient clicker and Battery/keyboard player. Every successful scenario also verifies a committed character/world checkpoint and no unexpected browser runtime errors.

## Findings and fixes

The tests exposed a real portable-backup defect: uninitialized world-string slots survived in-memory saves but became JSON `null`, causing import rejection. The worker now serializes dense strings and explicit empty inventory slots. Storage canonicalizes legacy empty string slots after verifying their original SHA-256 checksum. A new regression test checks sparse export, legacy recovery, unchanged input, tampering rejection and invalid numeric string values.

The replacement-client failure came from the automation logging in before client loading finished. The driver now waits for the running game loop as well as transport readiness and includes login diagnostics on failure. Host kick and replacement login pass with that readiness condition; no room-control change was needed.

Other initial failures were test-fixture errors: blocked walking tiles, choosing a mine without copper, consecutive dialogue pages reusing an interface ID, engine XP stored in tenths, ground-drop ownership using player IDs, and nonstackable loot represented as separate ground objects. Corrected checks now verify real actions, ownership and pickups instead of assuming those representations.

## Evidence and reproduction

`tools/tests/browser-personas.cjs` runs the scenarios; `tools/tests/gameplay-driver.cjs` instruments development client/worker responses only in the test browser. Gameplay actions use the client and server protocol. Fixture-only worker access positions characters near activities and prepares injured/combat stats; those setups do not claim travel-route, leveling or damage-balancing coverage. Most scenarios use the original guide's tutorial-skip option. Multiplayer runs through application relay in isolated profiles on one machine.

Prepare the pinned server and development co-op assets using the setup guide, then keep `npm run coop` running. Use an installed Playwright module and Chromium:

```sh
LORESCAPE_PLAYWRIGHT_PATH=/opt/codex/cua_node/lib/node_modules/playwright \
LORESCAPE_CHROMIUM_PATH=/usr/bin/chromium \
npm run test:personas
```

Optional `LORESCAPE_SCENARIOS=14,15` selects cases for reruns; `LORESCAPE_TEST_URL` changes the lobby origin. Per-case JSON and screenshots are written under ignored `.local/persona-tests/`. `last-run.json` contains only the latest invocation; `verified-results.json` records the final 20-case evidence collected across the full run and affected-case reruns.

Additional regression checks passed: 77 client tests, nine room/protocol/storage tests, native IndexedDB fault/recovery checks and the offline browser suite. The updated worker bundle and co-op development client build pass. Pure WebRTC, physical-device performance, long sessions and exhaustive quests/content remain outside this run. See [verification](COOP-VERIFICATION.md) for earlier production and multiplayer validation.
