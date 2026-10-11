<div align="center">

<h1>2004Scape Client2 - May 18, 2004</h1>

[Website](https://2004scape.org) | [Discord](https://discord.2004scape.org) | [Rune-Server](https://www.rune-server.ee/runescape-development/rs2-server/projects/701698-lost-city-225-emulation.html)

**status: completely ported**

**The client code was source ported to TypeScript by us.**  
**Jagex has never had any source code leaks.**
</div>

## Site Index

### Client

Try out the client hosted on Github! It is 100% source ported and available to use.
Create your account on the 2004scape website.

| World           | High Detail                                                                    | Low Detail                                                                    | Members |
|-----------------|--------------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------|
| 1 (Central USA) | [Play Now!](https://2004scape.github.io/Client2/?world=1&detail=high&method=0) | [Play Now!](https://2004scape.github.io/Client2/?world=1&detail=low&method=0) | No      |
| 2 (Central USA) | [Play Now!](https://2004scape.github.io/Client2/?world=2&detail=high&method=0) | [Play Now!](https://2004scape.github.io/Client2/?world=2&detail=low&method=0) | Yes     |
| 3 (Germany)     | [Play Now!](https://2004scape.github.io/Client2/?world=3&detail=high&method=0) | [Play Now!](https://2004scape.github.io/Client2/?world=3&detail=low&method=0) | Yes     |
| 4 (Germany)     | [Play Now!](https://2004scape.github.io/Client2/?world=4&detail=high&method=0) | [Play Now!](https://2004scape.github.io/Client2/?world=4&detail=low&method=0) | No      |

### <a href="https://2004scape.github.io/Client2/playground" target="_blank">Playground</a> - An Interactive Model Viewer
### <a href="https://2004scape.github.io/Client2/items" target="_blank">Items Viewer</a> - View All the Items
### <a href="https://2004scape.github.io/Client2/mesanim" target="_blank">Message Animation Viewer</a> - A Chat Message Animation Editor
### <a href="https://2004scape.github.io/Client2/sounds" target="_blank">Sounds Viewer</a> - Sounds Viewer & Listener
### <a href="https://2004scape.github.io/Client2/viewer" target="_blank">Viewer</a> - A Cache Viewer (WIP)
### <a href="https://2004scape.github.io/Client2/interface-editor" target="_blank">Interface Editor</a> - An Interface Editor (WIP)

---

## Commands

`::debug` Shows performance metrics (FPS, frame times and more).

`::chat` Changes between 3 different chat font eras.

`::fps` Set a targeted FPS (ex. `::fps 30`)

A developer can utilize the debug command for development purposes.
![debugging](https://github.com/2004scape/Client2/assets/76214316/9cec6fb5-7a79-4d81-97ed-a96a5fecd85a)

---

## First Time Installation

For production builds and self-hosting, see the [web hosting guide](docs/WEB-HOSTING.md). Run `npm ci`, `npm run setup:web`, and `npm start` for the complete optimized web app.

For LoreScape's private four-player browser experience, use the [co-op setup guide](docs/COOP-SETUP.md) and [implementation plan](docs/COOP-IMPLEMENTATION-PLAN.md). Run `npm ci`, `npm run setup:coop`, then `npm run coop`. The setup pins a compatible historical server and adapts its browser bundler; the general upstream client development instructions follow below.

```shell
npm install
npm run prepare
npm run build:dev
```

If you are on a Mac:
```shell
chmod ug+x .husky/*
chmod ug+x .git/hooks/*
```

## Local

Local development should be done with: `npm run dev`

The client will automatically launch connecting to World 1.
Local world is hosted on World 0.
You have the ability to connect to live servers from the local client by changing the param.

http://localhost:8080/?world=0&detail=high&method=0 (TypeScript)

This is not to be confused with the Java TeaVM client which is hosted here if the local server is running:

http://localhost/client?world=0&detail=high&method=0 (Java)

## Offline single-player and private co-op

Run `npm ci`, `npm run setup:coop`, and `npm run coop`, then open the lobby at http://localhost:8080/coop.html. Choose **Play solo** for local play, or create a saved world and share its room code with three friends. Download the offline game once to keep solo play available after stopping the server. The host's browser runs the original world and automatically saves party progression. WebRTC and optional application relay replace the upstream clipboard handshake.

The lobby includes Chromebook battery/display settings, offline downloads, browser storage status, world management, party status, host removal controls, XP and NPC loot quantity settings, shared loot, and backup/recovery controls. See the [setup guide](docs/COOP-SETUP.md) for secure hosting, persistence scope, and test commands, and the [verification record](docs/COOP-VERIFICATION.md) for tested behavior and remaining external checks.

The [code audit](docs/CODE-AUDIT.md) records storage/transport fixes and the offline persistence contract.

The [gameplay test report](docs/PERSONA-TEST-REPORT.md) records 20 passing scripted sessions across eight player styles, including skilling, combat, four-player chat, backup transfer and device controls. Run `npm run test:personas` with a development co-op build and local server; the report documents browser paths and test limits.
