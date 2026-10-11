const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const d = require('./gameplay-driver.cjs');
const base = process.env.LORESCAPE_TEST_URL || 'http://localhost:8080';
const output = path.resolve(__dirname, '../../.local/persona-tests');
fs.mkdirSync(output, {recursive: true});

function worker(page) {
    return page.workers().find(worker => worker.url().endsWith('/worker.js'));
}
async function state(page) {
    return worker(page).evaluate(() => {
        const player = [...__playWorld.players][0];
        return {
            name: player.username,
            x: player.x,
            z: player.z,
            xp: Array.from(player.stats),
            levels: Array.from(player.levels),
            tutorial: player.getVar(__types.VarPlayerType.getId('tutorial_progress')),
            items: player.getInventory(93).items.map(item => item && {id: item.id, count: item.count}),
            tick: __playWorld.currentTick
        };
    });
}
async function save(page) {
    await page.evaluate(() => window.LoreCoop.request('coop-checkpoint'));
    return page.evaluate(async () => {
        const {SaveStore} = await import('/coop/storage.mjs');
        const data = (await new SaveStore().load(window.LoreCoop.worldId)).data;
        return {characters: Object.keys(data.characters), world: !!data.world};
    });
}
async function reopen(ctx) {
    const id = await ctx.page.evaluate(() => window.LoreCoop.worldId);
    await ctx.page.locator('#leave').click();
    await ctx.page.reload();
    await ctx.page.waitForFunction(id => document.querySelector('#worlds').value === id, id);
    await ctx.page.locator('#solo').click();
    ctx.game = await d.frame(ctx.page);
    await d.login(ctx.game, ctx.name);
}
async function locate(page, kind, x, z, radius = 18) {
    return worker(page).evaluate(
        ({kind, x, z, radius}) => {
            const result = [];
            for (let px = x - radius; px <= x + radius; px++)
                for (let pz = z - radius; pz <= z + radius; pz++) {
                    const zone = __playWorld.gameMap.getZone(px, pz, 0);
                    for (const loc of zone.getLocsSafe(((px & 7) << 4) | (pz & 7))) {
                        const type = __types.LocType.get(loc.type);
                        if ((kind === 'tree' && type.name === 'Tree' && type.op?.[0] === 'Chop down') || (kind === 'copper' && type.debugname.startsWith('copperrock')) || (kind === 'door' && type.name === 'Door' && type.op?.[0] === 'Open'))
                            result.push({x: loc.x, z: loc.z, type: loc.type, name: type.debugname, shape: loc.shape, angle: loc.angle});
                    }
                }
            return result.sort((a, b) => Math.abs(a.x - x) + Math.abs(a.z - z) - (Math.abs(b.x - x) + Math.abs(b.z - z)))[0];
        },
        {kind, x, z, radius}
    );
}
async function operateLoc(ctx, target) {
    assert(target, 'Location fixture missing');
    await ctx.game.evaluate(async target => {
        const game = window.__playGame,
            x = target.x - game.sceneBaseTileX,
            z = target.z - game.sceneBaseTileZ;
        const bitset = (x + (z << 7) + (target.type << 14) + 0x40000000) | 0;
        assertScene();
        function assertScene() {
            if (game.scene.getInfo(game.currentLevel, x, z, bitset) === -1) throw new Error('Target is not rendered in the scene');
        }
        game.menuAction[0] = 285;
        game.menuParamA[0] = bitset;
        game.menuParamB[0] = x;
        game.menuParamC[0] = z;
        await game.useMenuOption(0);
    }, target);
}
async function skill(ctx, kind) {
    const positions = {tree: [3200, 3240], copper: [3284, 3365]};
    const stat = kind === 'tree' ? 8 : 14;
    const [x, z] = positions[kind];
    await d.teleport(ctx.page, ctx.game, x, z);
    const target = await locate(ctx.page, kind, x, z);
    const before = await state(ctx.page);
    await operateLoc(ctx, target);
    await ctx.game.waitForFunction(({stat, xp}) => window.__playGame.skillExperience[stat] > xp, {stat, xp: before.xp[stat] / 10}, {timeout: 60000});
    const after = await state(ctx.page);
    assert(after.xp[stat] > before.xp[stat]);
    assert(after.items.filter(Boolean).length > before.items.filter(Boolean).length, 'No gathered item');
    return {target: target.name, earnedXp: after.xp[stat] - before.xp[stat], items: after.items.filter(Boolean).length};
}
async function chicken(ctx, rates = false) {
    if (rates) {
        await ctx.page.locator('#xpRate').selectOption('5');
        await ctx.page.locator('#lootRate').selectOption('3');
        await ctx.page.locator('#lootMode').selectOption('shared');
        await ctx.page.locator('#applySettings').click();
        await ctx.page.waitForFunction(() => document.querySelector('#notice').textContent.includes('applied and saved'));
    }
    // A mid-level test character makes a real chicken fight reliably short.
    const target = await worker(ctx.page).evaluate(() => {
        const p = [...__playWorld.players][0];
        p.setLevel(0, 20);
        p.setLevel(2, 20);
        p.setLevel(3, 20);
        const npc = [...__playWorld.npcs].filter(n => __types.NpcType.get(n.type).name === 'Chicken' && n.x > 3200 && n.x < 3240 && n.z > 3270 && n.z < 3310).sort((a, b) => a.nid - b.nid)[0];
        if (!npc) throw new Error('Chicken fixture missing');
        return {id: npc.nid, x: npc.x, z: npc.z};
    });
    await d.teleport(ctx.page, ctx.game, target.x - 1, target.z);
    await ctx.game.waitForFunction(id => !!window.__playGame.npcs[id], target.id);
    const before = await state(ctx.page);
    await d.menu(ctx.game, 542, target.id);
    await ctx.game.waitForFunction(xp => window.__playGame.skillExperience[0] > xp, before.xp[0] / 10, {timeout: 60000});
    const raw = await worker(ctx.page).evaluate(() => __types.ObjType.getId('raw_chicken'));
    await ctx.game.waitForFunction(
        raw => {
            const g = window.__playGame;
            for (const row of g.levelObjStacks[g.currentLevel])
                for (const stack of row || [])
                    if (stack) {
                        for (let item = stack.head(); item; item = stack.next()) if (item.index === raw || item.type === raw) return true;
                    }
            return false;
        },
        raw,
        {timeout: 45000}
    );
    const drops = await worker(ctx.page).evaluate(
        ({x, z, raw}) => {
            const p = [...__playWorld.players][0],
                found = [];
            for (let px = x - 6; px <= x + 6; px++)
                for (let pz = z - 6; pz <= z + 6; pz++) {
                    const zone = __playWorld.gameMap.getZone(px, pz, 0);
                    for (const obj of zone.getObjsSafe(((px & 7) << 4) | (pz & 7))) {
                        if (obj.type === raw && (obj.receiverId === -1 || obj.receiverId === p.pid)) found.push({count: obj.count, owner: obj.receiverId, x: obj.x, z: obj.z});
                    }
                }
            return found;
        },
        {...target, raw}
    );
    assert(drops.length, 'No real NPC death drop');
    if (rates) {
        // Non-stackable drops become three separate ground objects.
        assert.equal(
            drops.reduce((total, drop) => total + drop.count, 0),
            3
        );
        assert(drops.some(drop => drop.owner === -1));
    }
    const expected = drops.reduce((total, drop) => total + drop.count, 0);
    for (let index = 0; index < drops.length; index++) {
        const drop = drops[index];
        const position = await ctx.game.evaluate(({x, z}) => ({x: x - __playGame.sceneBaseTileX, z: z - __playGame.sceneBaseTileZ}), drop);
        await d.menu(ctx.game, 99, raw, position.x, position.z);
        const deadline = Date.now() + 15000;
        let received = false;
        while (Date.now() < deadline) {
            const count = await worker(ctx.page).evaluate(
                raw =>
                    [...__playWorld.players][0]
                        .getInventory(93)
                        .items.filter(item => item?.id === raw)
                        .reduce((sum, item) => sum + item.count, 0),
                raw
            );
            if (count >= index + 1) {
                received = true;
                break;
            }
            await ctx.page.waitForTimeout(100);
        }
        assert(received, 'Client could not pick up the real death drop');
    }
    const after = await state(ctx.page);
    assert.equal(
        after.items.filter(item => item?.id === raw).reduce((sum, item) => sum + item.count, 0),
        expected
    );
    return {earnedAttackXp: after.xp[0] - before.xp[0], drops, pickedUp: expected};
}

const cases = [
    {
        id: 1,
        persona: 'Newcomer',
        name: 'Keyboard login and character creation',
        tutorial: true,
        keyboard: true,
        run: async c => {
            await d.acceptDesign(c.game);
            await d.talkGuide(c.game);
            assert.notEqual(await c.game.evaluate(() => __playGame.chatInterfaceId), -1);
            return {name: (await state(c.page)).name, dialogue: 'RuneScape Guide'};
        }
    },
    {
        id: 2,
        persona: 'Newcomer',
        name: 'Mixed-case spaced name survives restart',
        tutorial: true,
        character: 'New Friend',
        run: async c => {
            await d.acceptDesign(c.game);
            const before = await state(c.page);
            await save(c.page);
            await reopen(c);
            const after = await state(c.page);
            assert.equal(after.name, 'new_friend');
            assert.equal(after.tutorial, before.tutorial);
            return {normalizedName: after.name};
        }
    },
    {
        id: 3,
        persona: 'Newcomer',
        name: 'Decline tutorial skip and advance guide dialogue',
        tutorial: true,
        run: async c => {
            await d.acceptDesign(c.game);
            await d.talkGuide(c.game);
            await d.continueDialogue(c.game);
            await d.menu(c.game, 951, 0, 0, d.interfaces.get('multi2:com_2'));
            await c.game.waitForFunction(id => __playGame.chatInterfaceId !== id, d.interfaces.get('multi2'));
            for (let i = 0; i < 5; i++) await d.continueDialogue(c.game);
            const after = await state(c.page);
            assert(after.tutorial >= 3 && after.tutorial < 1000);
            return {tutorialStage: after.tutorial};
        }
    },
    {
        id: 4,
        persona: 'Explorer',
        name: 'Walk around Lumbridge and preserve position',
        run: async c => {
            await d.walk(c.game, 3222, 3217);
            await d.walk(c.game, 3226, 3217);
            const before = await state(c.page);
            await save(c.page);
            await reopen(c);
            const after = await state(c.page);
            assert.equal(after.x, before.x);
            assert.equal(after.z, before.z);
            return {position: [after.x, after.z]};
        }
    },
    {
        id: 5,
        persona: 'Explorer',
        name: 'Load a different map region and keep walking',
        run: async c => {
            await d.teleport(c.page, c.game, 3200, 3245);
            const old = await c.game.evaluate(() => __playGame.sceneBaseTileX);
            await d.walkNearby(c.game);
            // The fixtures place the character in another region; movement
            // afterwards still travels through the client and server.
            await d.teleport(c.page, c.game, 3210, 3424);
            await d.walkNearby(c.game);
            const now = await c.game.evaluate(() => __playGame.sceneBaseTileX);
            const newZ = await c.game.evaluate(() => __playGame.sceneBaseTileZ);
            assert(newZ >= 3360, 'The different map region did not load');
            return {sceneBaseBefore: old, sceneBaseAfter: now, position: [(await state(c.page)).x, (await state(c.page)).z]};
        }
    },
    {
        id: 6,
        persona: 'Explorer',
        name: 'Examine scenery, rotate camera and switch tabs',
        run: async c => {
            await d.teleport(c.page, c.game, 3200, 3240);
            const target = await locate(c.page, 'tree', 3200, 3240);
            await d.menu(c.game, 1175, target.type << 14);
            assert.match(await c.game.evaluate(() => __playGame.messageText[0]), /tree|RuneScape/i);
            const yaw = await c.game.evaluate(() => __playGame.orbitCameraYaw);
            await c.game.locator('#canvas').focus();
            await c.game.locator('#canvas').press('ArrowRight', {delay: 700});
            for (const [tab, x] of [
                [1, 594],
                [3, 656],
                [4, 691]
            ]) {
                await c.game.locator('#canvas').click({position: {x, y: 212}});
                await c.game.waitForFunction(tab => __playGame.selectedTab === tab, tab);
            }
            assert.equal(await c.game.evaluate(() => __playGame.selectedTab), 4);
            assert.notEqual(await c.game.evaluate(() => __playGame.orbitCameraYaw), yaw);
            return {cameraBefore: yaw, cameraAfter: await c.game.evaluate(() => __playGame.orbitCameraYaw), examined: target.name};
        }
    },
    {id: 7, persona: 'Skiller', name: 'Chop a tree for logs and woodcutting XP', run: c => skill(c, 'tree')},
    {
        id: 8,
        persona: 'Skiller',
        name: 'Net fish for shrimp and fishing XP',
        run: async c => {
            const target = await worker(c.page).evaluate(() => {
                const n = [...__playWorld.npcs].find(n => n.x > 3070 && n.x < 3100 && n.z > 3200 && n.z < 3260 && __types.NpcType.get(n.type).op?.[0] === 'Net');
                if (!n) throw new Error('Net fishing spot missing');
                return {id: n.nid, x: n.x, z: n.z};
            });
            await d.teleport(c.page, c.game, target.x + 1, target.z);
            await c.game.waitForFunction(id => !!__playGame.npcs[id], target.id);
            const before = await state(c.page);
            await d.menu(c.game, 728, target.id);
            await c.game.waitForFunction(xp => __playGame.skillExperience[10] > xp, before.xp[10] / 10, {timeout: 60000});
            const after = await state(c.page);
            assert(after.items.filter(Boolean).length > before.items.filter(Boolean).length, 'Fishing awarded no item');
            return {earnedXp: after.xp[10] - before.xp[10], items: after.items.filter(Boolean).length};
        }
    },
    {id: 9, persona: 'Skiller', name: 'Mine copper for ore and mining XP', run: c => skill(c, 'copper')},
    {id: 10, persona: 'Warrior', name: 'Fight a chicken and receive its death drops', run: c => chicken(c)},
    {id: 11, persona: 'Warrior', name: 'Fight with XP boost and shared triple loot', run: c => chicken(c, true)},
    {
        id: 12,
        persona: 'Warrior',
        name: 'Eat food to restore injured hitpoints',
        run: async c => {
            const food = await worker(c.page).evaluate(() => {
                const p = [...__playWorld.players][0];
                p.levels[3] = 3;
                p.changeStat(3);
                const id = __types.ObjType.getId('bread');
                const slot = p.getInventory(93).items.findIndex(item => item?.id === id);
                return {id, slot};
            });
            assert(food.slot >= 0);
            await c.game.waitForFunction(() => __playGame.skillLevel[3] === 3);
            await d.menu(c.game, 405, food.id, food.slot, d.interfaces.get('inventory:inv'));
            await c.game.waitForFunction(() => __playGame.skillLevel[3] > 3);
            const after = await state(c.page);
            assert(after.levels[3] > 3);
            assert(!after.items.some(item => item?.id === food.id), 'Eating did not consume the bread');
            return {hitpointsAfterEating: after.levels[3]};
        }
    },
    {
        id: 13,
        persona: 'Social host',
        name: 'Four players exchange public chat',
        room: true,
        run: async c => {
            await c.joinParty(3);
            await c.game.locator('#canvas').focus();
            await c.game.locator('#canvas').pressSequentially('hello party');
            await c.game.locator('#canvas').press('Enter');
            await Promise.all(c.guests.map(g => g.game.waitForFunction(() => __playGame.messageText.some(text => text?.toLowerCase().includes('hello party')))));
            return {players: 4, chatSeenByGuests: 3};
        }
    },
    {
        id: 14,
        persona: 'Social host',
        name: 'Full room, host kick and slot reuse',
        room: true,
        run: async c => {
            await c.joinParty(3);
            const extra = await c.extraPage();
            await extra.page.locator('#code').fill(await c.page.locator('#roomCode').textContent());
            await extra.page.locator('#join').click();
            await extra.page.waitForFunction(() => document.querySelector('#notice').textContent.includes('full'));
            await c.page.locator('#party button').first().click();
            await c.page.waitForFunction(() => document.querySelector('#slots').textContent.startsWith('3'));
            await extra.page.locator('#transport').selectOption('relay');
            await extra.page.locator('#join').click();
            extra.game = await d.frame(extra.page, false);
            await d.login(extra.game, 'replacement');
            await c.page.waitForFunction(() => document.querySelector('#slots').textContent.startsWith('4'));
            return {rejectedFifth: true, slotReused: true};
        }
    },
    {
        id: 15,
        persona: 'Cautious saver',
        name: 'Back up a played character and import into another profile',
        run: async c => {
            await d.walk(c.game, 3222, 3218);
            const download = c.page.waitForEvent('download');
            await c.page.locator('#sessionExport').click();
            const file = await download;
            const text = fs.readFileSync(await file.path(), 'utf8');
            const extra = await c.extraPage();
            const data = await extra.page.evaluate(async text => {
                const {SaveStore} = await import('/coop/storage.mjs');
                const s = new SaveStore(),
                    w = await s.import(text);
                return {characters: Object.keys(w.characters), id: w.id};
            }, text);
            assert(data.characters.includes(c.name));
            await extra.page.reload();
            await extra.page.waitForFunction(id => [...document.querySelector('#worlds').options].some(option => option.value === id), data.id);
            await extra.page.locator('#worlds').selectOption(data.id);
            await extra.page.locator('#solo').click();
            extra.game = await d.frame(extra.page);
            await d.login(extra.game, c.name);
            const restored = await state(extra.page);
            assert.deepEqual([restored.x, restored.z], [3222, 3218]);
            await extra.page.locator('#leave').click();
            return {portableCharacters: data.characters, restoredPosition: [restored.x, restored.z]};
        }
    },
    {
        id: 16,
        persona: 'Cautious saver',
        name: 'Quota failure exports unsaved progress and recovers',
        run: async c => {
            await d.walk(c.game, 3222, 3218);
            await c.page.evaluate(async () => {
                const {SaveStore} = await import('/coop/storage.mjs');
                window.__commit = SaveStore.prototype.commit;
                SaveStore.prototype.commit = async () => {
                    throw new DOMException('Simulated full storage', 'QuotaExceededError');
                };
            });
            await c.page.locator('#save').click();
            await c.page.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('Storage is full'));
            const download = c.page.waitForEvent('download');
            await c.page.locator('#sessionExport').click();
            const file = await download;
            const text = fs.readFileSync(await file.path(), 'utf8');
            assert(Object.hasOwn(JSON.parse(text).snapshot.data.characters, c.name));
            await c.page.evaluate(async () => {
                const {SaveStore} = await import('/coop/storage.mjs');
                SaveStore.prototype.commit = window.__commit;
            });
            await save(c.page);
            return {emergencyExport: true, savingRecovered: true};
        }
    },
    {
        id: 17,
        persona: 'Impatient clicker',
        name: 'Rapid launch clicks, settings and repeated saves',
        rapid: true,
        run: async c => {
            const id = await c.page.evaluate(() => window.LoreCoop.worldId);
            for (const rate of ['2', '10', '1']) {
                await c.page.locator('#xpRate').selectOption(rate);
                await c.page.locator('#applySettings').click();
                await c.page.waitForFunction(() => !document.querySelector('#applySettings').disabled);
            }
            await c.page.evaluate(() => Promise.all(Array.from({length: 5}, () => window.LoreCoop.request('coop-checkpoint'))));
            assert.equal(await c.page.evaluate(() => window.LoreCoop.worldId), id);
            return {queuedSaves: 5, finalRate: await c.page.evaluate(() => window.LoreCoop.data.settings.xpRate)};
        }
    },
    {
        id: 18,
        persona: 'Impatient clicker',
        name: 'Repeated room-to-solo transitions keep character state',
        room: true,
        run: async c => {
            await d.walk(c.game, 3222, 3218);
            await save(c.page);
            await reopen(c);
            assert(await c.page.evaluate(() => window.LoreCoop.solo));
            assert.equal((await state(c.page)).z, 3218);
            await reopen(c);
            assert.equal((await state(c.page)).z, 3218);
            return {transitions: 2, preservedPosition: true};
        }
    },
    {
        id: 19,
        persona: 'Battery/keyboard player',
        name: '15 FPS, keyboard chat, Ctrl+S and fullscreen',
        battery: true,
        run: async c => {
            assert.equal(await c.game.evaluate(() => __playGame.tfps), 15);
            await c.game.locator('#canvas').focus();
            await c.game.locator('#canvas').pressSequentially('battery test');
            await c.game.locator('#canvas').press('Enter');
            await c.game.waitForFunction(() => __playGame.messageText.some(text => text?.toLowerCase().includes('battery test')));
            await c.game.locator('#canvas').press('Control+s');
            await c.page.waitForFunction(() => document.querySelector('#notice').textContent.includes('progress saved'));
            await c.page.locator('#fullscreen').click();
            assert(await c.page.evaluate(() => !!document.fullscreenElement));
            await c.page.locator('#exitFullscreen').click();
            return {fps: 15, keyboardSave: true, fullscreen: true};
        }
    },
    {
        id: 20,
        persona: 'Battery/keyboard player',
        name: 'Narrow viewport and live FPS/audio preferences persist',
        battery: true,
        run: async c => {
            await c.page.setViewportSize({width: 800, height: 700});
            await c.page.locator('#scale').selectOption('fit');
            await c.page.locator('#fps').selectOption('30');
            await c.page.locator('#mute').uncheck();
            await c.page.locator('#deviceSave').click();
            await c.game.waitForFunction(() => __playGame.tfps === 30);
            const box = await c.page.locator('#game').boundingBox();
            assert(box.width <= 800 && box.width > 500);
            await reopen(c);
            assert.equal(await c.game.evaluate(() => __playGame.tfps), 30);
            assert.equal(await c.page.locator('#mute').isChecked(), false);
            return {width: box.width, fps: 30, preferencesRestored: true};
        }
    }
];

(async () => {
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    const selected = process.env.LORESCAPE_SCENARIOS?.split(',').map(Number);
    const results = [];
    try {
        for (const test of cases.filter(test => !selected || selected.includes(test.id))) {
            const started = Date.now(),
                contexts = [];
            const result = {id: test.id, persona: test.persona, scenario: test.name, started: new Date().toISOString()};
            try {
                const errors = [];
                async function extraPage() {
                    const context = await browser.newContext({serviceWorkers: 'block', acceptDownloads: true, viewport: {width: 1366, height: 850}});
                    contexts.push(context);
                    const page = await context.newPage();
                    const pageErrors = await d.open(page, base);
                    errors.push(pageErrors);
                    return {page, context};
                }
                const ctx = await extraPage();
                ctx.name = test.character || `persona${String(test.id).padStart(2, '0')}`;
                ctx.extraPage = extraPage;
                ctx.guests = [];
                await ctx.page.locator('#worldName').fill(`${test.persona} ${test.id}`);
                if (test.battery) await ctx.page.locator('#batteryPreset').click();
                if (test.rapid)
                    await ctx.page.evaluate(() => {
                        for (let i = 0; i < 8; i++) {
                            document.querySelector('#solo').click();
                            document.querySelector('#host').click();
                        }
                    });
                else await ctx.page.locator(test.room ? '#host' : '#solo').click();
                ctx.game = await d.frame(ctx.page);
                await d.login(ctx.game, ctx.name, test.keyboard);
                if (!test.tutorial) await d.skipTutorial(ctx.game);
                ctx.joinParty = async count => {
                    const code = await ctx.page.locator('#roomCode').textContent();
                    for (let i = 0; i < count; i++) {
                        const guest = await extraPage();
                        await guest.page.locator('#transport').selectOption('relay');
                        await guest.page.locator('#code').fill(code);
                        await guest.page.locator('#join').click();
                        guest.game = await d.frame(guest.page, false);
                        await d.login(guest.game, `guest${test.id}${i}`);
                        await d.skipTutorial(guest.game);
                        ctx.guests.push(guest);
                    }
                    await Promise.all([ctx.game, ...ctx.guests.map(g => g.game)].map(game => game.waitForFunction(() => __playGame.playerCount >= 3)));
                };
                result.evidence = await test.run(ctx);
                result.saved = await save(ctx.page);
                assert(result.saved.characters.length > 0 && result.saved.world);
                await ctx.page.screenshot({path: path.join(output, `${String(test.id).padStart(2, '0')}.png`)});
                await ctx.page.locator('#leave').click();
                assert.deepEqual(errors.flat(), [], 'Unexpected browser runtime errors');
                result.status = 'passed';
            } catch (error) {
                result.status = 'failed';
                result.error = error.stack;
                console.error(result.error);
                for (const context of contexts) for (const page of context.pages()) await page.screenshot({path: path.join(output, `${test.id}-failure.png`)}).catch(() => {});
            } finally {
                for (const context of contexts) await context.close();
                result.durationMs = Date.now() - started;
                results.push(result);
                fs.writeFileSync(path.join(output, `${String(test.id).padStart(2, '0')}.json`), JSON.stringify(result, null, 2));
                console.log(`${result.status.toUpperCase()} ${test.id}/20 ${test.persona}: ${test.name} (${(result.durationMs / 1000).toFixed(1)}s)`);
            }
        }
    } finally {
        await browser.close();
    }
    fs.writeFileSync(path.join(output, 'last-run.json'), JSON.stringify(results, null, 2));
    if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
