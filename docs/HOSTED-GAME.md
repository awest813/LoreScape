# Private browser game

Live game: https://lorescape-private-play.nerdretro.chatgpt.site

Private deployment confirmed October 11, 2026. Open while signed in to the owning ChatGPT account. Select **Play solo**, wait for the client to load, then select **Existing User** and enter a character name and a private password. The local engine creates a new character when that name has no save in this browser. Progress saves automatically; export backups before clearing browser data.

The hosted copy supports browser-hosted solo play, local saves, backup import/export, world settings, device controls and offline download. It does not host the Node WebSocket room service. Four-player rooms remain available in the original local project through `npm run coop`; hosted room buttons are hidden.

Deployment source: `/workspace/sites/lorescape-play`. The static package contains only the offline manifest's required assets plus the service worker and manifest. Root navigation redirects to the lobby; the original query-based iframe game route remains available. Asset hashes were regenerated after the hosted HTML changes. No player saves were packaged.

Published source and deployment versions are tracked in the Site repository; production self-hosting builds are tracked in this GitHub repository.

Validation: fresh keyboard login/character creation and movement/save/restart passed on the local server; movement/save/restart also passed against the exact static package before deployment. The hosting service reported successful private deployment. The authenticated live-site gameplay flow has not been independently automated.

For a repeatable production package or your own Node/static host, see [WEB-HOSTING.md](WEB-HOSTING.md). The polished solo launcher is mirrored in `src/solo/`; the GitHub build supports private co-op and the same solo export.
