const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const serverDir = process.env.LORESCAPE_SERVER_DIR || path.resolve(__dirname, '../../.local/server');
const pack = fs.readFileSync(path.join(serverDir, 'data/src/pack/interface.pack'), 'utf8');
const interfaces = new Map(
    pack
        .trim()
        .split(/\r?\n/)
        .map(line => {
            const [id, name] = line.split('=');
            return [name, Number(id)];
        })
);
const names = new Map([...interfaces].map(([name, id]) => [id, name]));

async function instrument(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/index.js', async route => {
        const headers = {...route.request().headers()};
        delete headers['if-modified-since'];
        delete headers['if-none-match'];
        const response = await route.fetch({headers});
        const source = await response.text();
        assert(source.includes('new Game().run()'), `Use build:coop development output: ${response.status()} ${route.request().url()} (${source.length} bytes)`);
        await route.fulfill({response, body: source.replace('new Game().run()', '(window.__playGame = new Game()).run()')});
    });
    await page.route('**/worker.js', async route => {
        const headers = {...route.request().headers()};
        delete headers['if-modified-since'];
        delete headers['if-none-match'];
        const response = await route.fetch({headers});
        const source = await response.text();
        const marker = 'self.postMessage({ type: "ready" });';
        assert(source.includes(marker));
        await route.fulfill({response, body: source.replace(marker, 'Object.assign(globalThis, {__playWorld: World_default, __types: {ObjType, LocType, NpcType, VarPlayerType}}); ' + marker)});
    });
    return errors;
}
async function open(page, base) {
    const errors = await instrument(page);
    await page.goto(base + '/coop.html');
    await page.locator('#scale').selectOption('native');
    await page.locator('#deviceSave').click();
    return errors;
}
async function frame(page, host = true) {
    await page.waitForFunction(() => document.querySelector('#game').contentWindow.location.search.includes('world='));
    const game = page.frames().find(frame => frame.url().includes('world='));
    await game.waitForFunction(() => window.__playGame?.fontBold12 && window.__playGame.loopCycle > 0 && (window.__playGame.workerReady || window.__playGame.peer?.uniqueId), null, {timeout: 60000});
    if (host) await page.waitForFunction(() => window.LoreCoop?.ready);
    return game;
}
async function login(game, name, keyboard = false) {
    if (keyboard) {
        const canvas = game.locator('#canvas');
        await canvas.click({position: {x: 474, y: 306}});
        await game.waitForFunction(() => window.__playGame.titleScreenState === 2);
        await canvas.pressSequentially(name, {delay: 35});
        await canvas.press('Tab');
        await canvas.pressSequentially('private', {delay: 35});
        await canvas.click({position: {x: 314, y: 336}});
    } else
        await game.evaluate(async name => {
            const game = window.__playGame;
            game.username = name;
            game.password = 'private';
            await Promise.race([game.login(name, game.password, false), new Promise((_, reject) => setTimeout(() => reject(new Error('Gameplay login timed out')), 45000))]);
        }, name);
    await game
        .waitForFunction(() => window.__playGame.ingame && window.__playGame.sceneState === 2, null, {timeout: 40000})
        .catch(async error => {
            const diagnostic = await game.evaluate(() => {
                const g = window.__playGame;
                return {name: g.username, ingame: g.ingame, scene: g.sceneState, message: g.loginMessage0 + ' ' + g.loginMessage1, loopCycle: g.loopCycle};
            });
            throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
        });
}
async function menu(game, action, a = 0, b = 0, c = 0) {
    await game.evaluate(
        async ({action, a, b, c}) => {
            const game = window.__playGame;
            game.menuAction[0] = action;
            game.menuParamA[0] = a;
            game.menuParamB[0] = b;
            game.menuParamC[0] = c;
            await game.useMenuOption(0);
        },
        {action, a, b, c}
    );
}
async function acceptDesign(game) {
    if (await game.evaluate(() => window.__playGame.viewportInterfaceId === 3559)) {
        await menu(game, 951, 0, 0, interfaces.get('player_kit:accept'));
        await game.waitForFunction(() => window.__playGame.viewportInterfaceId === -1);
    }
}
async function continueDialogue(game) {
    const id = await game.evaluate(() => window.__playGame.chatInterfaceId);
    const name = names.get(id);
    assert(name?.startsWith('npcchat'), `Unexpected dialogue: ${id}/${name}`);
    const child = Number(name.slice('npcchat'.length)) + 2;
    await menu(game, 44, 0, 0, interfaces.get(`${name}:com_${child}`));
    // Consecutive dialogue pages may reuse the same interface ID.
    await game.waitForFunction(() => !window.__playGame.pressedContinueOption);
}
async function talkGuide(game) {
    const guide = await game.evaluate(() => {
        const game = window.__playGame;
        return game.npcIds.slice(0, game.npcCount).find(id => game.npcs[id]?.type?.name === 'RuneScape Guide');
    });
    assert(Number.isInteger(guide), 'RuneScape Guide missing');
    await menu(game, 728, guide);
    await game.waitForFunction(() => window.__playGame.chatInterfaceId !== -1);
}
async function skipTutorial(game) {
    await acceptDesign(game);
    await talkGuide(game);
    await continueDialogue(game);
    assert.equal(await game.evaluate(() => window.__playGame.chatInterfaceId), interfaces.get('multi2'));
    await menu(game, 951, 0, 0, interfaces.get('multi2:com_1'));
    await game.waitForFunction(
        () => {
            const game = window.__playGame;
            return game.sceneState === 2 && game.localPlayer.pathTileX[0] + game.sceneBaseTileX === 3222 && game.localPlayer.pathTileZ[0] + game.sceneBaseTileZ === 3222;
        },
        null,
        {timeout: 30000}
    );
}
async function teleport(page, game, x, z) {
    const worker = page.workers().find(worker => worker.url().endsWith('/worker.js'));
    await worker.evaluate(
        ({x, z}) => {
            const player = [...__playWorld.players][0];
            player.closeModal();
            player.teleJump(x, z, 0);
        },
        {x, z}
    );
    await game.waitForFunction(
        ({x, z}) => {
            const game = window.__playGame;
            return game.sceneState === 2 && game.localPlayer.pathTileX[0] + game.sceneBaseTileX === x && game.localPlayer.pathTileZ[0] + game.sceneBaseTileZ === z;
        },
        {x, z},
        {timeout: 30000}
    );
    return worker;
}
async function walk(game, x, z) {
    assert(
        await game.evaluate(
            ({x, z}) => {
                const game = window.__playGame;
                return game.tryMove(game.localPlayer.pathTileX[0], game.localPlayer.pathTileZ[0], x - game.sceneBaseTileX, z - game.sceneBaseTileZ, 0, 0, 0, 0, 0, 0, false);
            },
            {x, z}
        ),
        'No route to walking target'
    );
    await game.waitForFunction(
        ({x, z}) => {
            const game = window.__playGame;
            return game.localPlayer.pathTileX[0] + game.sceneBaseTileX === x && game.localPlayer.pathTileZ[0] + game.sceneBaseTileZ === z;
        },
        {x, z},
        {timeout: 15000}
    );
}
async function walkNearby(game) {
    const destination = await game.evaluate(() => {
        const game = window.__playGame,
            sx = game.localPlayer.pathTileX[0],
            sz = game.localPlayer.pathTileZ[0];
        for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [2, 0],
            [-2, 0],
            [0, 2],
            [0, -2]
        ]) {
            if (game.tryMove(sx, sz, sx + dx, sz + dz, 0, 0, 0, 0, 0, 0, false)) return {x: sx + dx + game.sceneBaseTileX, z: sz + dz + game.sceneBaseTileZ};
        }
        return null;
    });
    assert(destination, 'No walkable adjacent tile in the region fixture');
    await game.waitForFunction(({x, z}) => {
        const game = window.__playGame;
        return game.localPlayer.pathTileX[0] + game.sceneBaseTileX === x && game.localPlayer.pathTileZ[0] + game.sceneBaseTileZ === z;
    }, destination);
    return destination;
}
module.exports = {interfaces, names, open, frame, login, menu, acceptDesign, continueDialogue, talkGuide, skipTutorial, teleport, walk, walkNearby};
