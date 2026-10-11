const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    const base = process.env.LORESCAPE_TEST_URL || 'http://localhost:8080';
    const mode = process.env.LORESCAPE_TRANSPORT || 'relay';
    const errors = [];
    const contexts = [];
    async function pageIn(context) {
        const page = await context.newPage();
        page.on('pageerror', error => {
            errors.push(error.stack);
            console.error(error.stack);
        });
        page.on('console', message => {
            if (message.type() === 'error') {
                errors.push(message.text());
                console.error(message.text());
            } else if (process.env.LORESCAPE_DEBUG) console.log(message.text());
        });
        await page.route('**/index.js', async route => {
            const response = await route.fetch();
            const source = await response.text();
            assert(source.includes('new Game().run()'), 'Use npm run build:coop for the smoke test');
            await route.fulfill({response, body: source.replace('new Game().run()', '(window.__smokeGame = new Game()).run()')});
        });
        await page.route('**/worker.js', async route => {
            const response = await route.fetch();
            const source = await response.text();
            const marker = 'self.postMessage({ type: "ready" });';
            assert(source.includes(marker));
            await route.fulfill({response, body: source.replace(marker, 'globalThis.__smokeWorld = World_default; globalThis.__smokeObjOps = ObjOps_default; globalThis.__smokeInvType = InvType; ' + marker)});
        });
        await page.goto(base + '/coop.html');
        return page;
    }
    async function frame(page, host = false) {
        await page.waitForFunction(() => document.querySelector('#game').contentWindow.location.search.includes('world='));
        const result = page.frames().find(frame => frame.url().includes('world='));
        assert(result, 'Game iframe was not created');
        await result.waitForFunction(() => window.__smokeGame?.fontBold12 && (window.__smokeGame?.workerReady || window.__smokeGame?.peer?.uniqueId), null, {timeout: 60000});
        if (host) await page.waitForFunction(() => window.LoreCoop?.ready, null, {timeout: 60000});
        return result;
    }
    async function login(frame, name) {
        await frame.evaluate(async name => {
            const game = window.__smokeGame;
            game.username = name;
            game.password = 'private';
            await Promise.race([game.login(name, game.password, false), new Promise((_, reject) => setTimeout(() => reject(new Error('Login timed out: ' + name)), 30000))]);
        }, name);
        await frame.waitForFunction(() => window.__smokeGame.ingame && window.__smokeGame.sceneState === 2, null, {timeout: 30000});
    }
    async function join(page, code, transport = mode) {
        await page.locator('#transport').selectOption(transport);
        await page.locator('#code').fill(code);
        await page.locator('#join').click();
        return frame(page);
    }
    try {
        for (let i = 0; i < 5; i++) contexts.push(await browser.newContext({serviceWorkers: 'block', viewport: {width: 1220, height: 850}}));
        const host = await pageIn(contexts[0]);
        await host.locator('#worldName').fill('Co-op acceptance');
        await host.locator('#host').click();
        let hf = await frame(host, true);
        const code = await host.locator('#roomCode').textContent();
        const worldId = await host.evaluate(() => window.LoreCoop.worldId);
        await login(hf, 'coophost');
        console.log('PASS: saved world started and host character entered the world');
        if (process.env.LORESCAPE_SMOKE_HOST_ONLY === '1') {
            assert.deepEqual(errors, []);
            return;
        }
        const guestPages = [],
            guestFrames = [];
        for (let i = 1; i <= 3; i++) {
            const page = await pageIn(contexts[i]);
            guestPages.push(page);
            const gf = await join(page, code);
            guestFrames.push(gf);
            await login(gf, ['', 'coopone', 'cooptwo', 'coopthree'][i]);
        }
        await Promise.all([hf, ...guestFrames].map(f => f.waitForFunction(() => window.__smokeGame.playerCount >= 3, null, {timeout: 30000})));
        console.log('PASS: four room-code clients logged in and received each other’s player updates (' + mode + ')');
        const extra = await pageIn(contexts[4]);
        await extra.locator('#code').fill(code);
        await extra.locator('#join').click();
        await extra.waitForFunction(() => document.querySelector('#notice').textContent.includes('full'));
        assert.equal(await extra.locator('#game').isVisible(), false);
        console.log('PASS: fifth player rejected');
        const secondHost = await pageIn(contexts[0]);
        await secondHost.locator('#worlds').selectOption(worldId);
        await secondHost.locator('#host').click();
        await secondHost.waitForFunction(() => document.querySelector('#notice').textContent.includes('another tab'));
        await secondHost.close();
        console.log('PASS: a second tab cannot host the same save');
        await host.locator('#xpRate').selectOption('5');
        await host.locator('#lootRate').selectOption('3');
        await host.locator('#lootMode').selectOption('shared');
        await host.locator('#applySettings').click();
        await host
            .waitForFunction(() => document.querySelector('#notice').textContent.includes('applied and saved'))
            .catch(async error => {
                console.log('SETTING FAILURE', await host.locator('#notice').textContent(), await host.locator('#saveStatus').textContent());
                throw error;
            });
        const worker = host.workers().find(worker => worker.url().endsWith('/worker.js'));
        assert(worker);
        const progress = await worker.evaluate(() => {
            const world = globalThis.__smokeWorld;
            const player = [...world.players].find(player => player.username === 'coophost');
            const guest = [...world.players].find(player => player.username === 'coopone');
            const before = player.stats[0];
            player.addXp(0, 1000);
            player.invAdd(93, 995, 123);
            guest.addXp(0, 500);
            guest.invAdd(93, 995, 77);
            const inv = [...world.invs].find(inv => inv.capacity > 0 && !globalThis.__smokeInvType.get(inv.type).restock);
            if (!inv) throw new Error('No stable shared inventory fixture');
            inv.set(0, {id: 995, count: 456});
            if (world.vars.length) world.vars[0] = 345;
            const coord = (player.level << 28) | (player.x << 14) | player.z;
            const state = {script: {info: {scriptName: '[ai_queue3,_guard]'}}, frames: [], fp: 0, popInts: () => [coord, 995, 2, 1000], activePlayer: player, pointerAdd: () => {}, intOperand: 0};
            globalThis.__smokeObjOps[3500](state);
            return {xp: player.stats[0], delta: player.stats[0] - before, guestXp: guest.stats[0], inventory: inv.type, loot: state.activeObj.count, receiver: state.activeObj.receiverId};
        });
        assert.equal(progress.delta, 5000);
        assert.equal(progress.loot, 6);
        assert.equal(progress.receiver, -1);
        console.log('PASS: worker applies XP ×5 and shared NPC loot quantity ×3');
        await guestFrames[0].evaluate(id => window.__smokeGame.peer.dc.send(JSON.stringify({type: 'connection', id})), await host.evaluate(() => window.LoreCoop.id));
        assert.equal(await worker.evaluate(() => [...globalThis.__smokeWorld.players].some(player => player.username === 'coophost')), true);
        console.log('PASS: forged host connection ID cannot replace the host socket');
        await host.waitForFunction(() => document.querySelector('#saveStatus').textContent.startsWith('Saved'), null, {timeout: 40000});
        // Wait for the periodic checkpoint to include the newly changed character.
        await host.waitForFunction(
            async expected => {
                const {SaveStore} = await import('/coop/storage.mjs');
                const store = new SaveStore();
                const data = (await store.load(window.LoreCoop.worldId)).data;
                return Object.keys(data.characters).length === 4 && data.world?.inventories.some(inv => inv.items.some(item => item?.id === 995 && item.count === 456));
            },
            null,
            {timeout: 45000}
        );
        console.log('PASS: periodic autosave committed all four characters and shared world state');
        await host.locator('#save').click();
        await host.waitForFunction(() => document.querySelector('#notice').textContent.includes('progress saved'));
        const exported = await host.evaluate(async () => {
            const {SaveStore} = await import('/coop/storage.mjs');
            return new SaveStore().export(window.LoreCoop.worldId);
        });
        assert.equal(Object.keys(JSON.parse(exported).snapshot.data.characters).length, 4);
        await guestPages[2].locator('#leave').click();
        await host.waitForFunction(() => document.querySelector('#slots').textContent.startsWith('3'));
        const replacement = await join(extra, code, 'auto');
        await login(replacement, 'coopthree');
        console.log('PASS: departure frees a slot and reconnect restores the character (automatic transport)');
        await host.screenshot({path: path.join(__dirname, '../.local/coop-party.png')});
        await host.locator('#leave').click();
        await guestPages[0].waitForFunction(() => !window.LoreCoop);
        await extra.waitForFunction(() => !window.LoreCoop);
        await host.reload();
        await host.locator('#worlds').selectOption(worldId);
        await host.locator('#host').click();
        hf = await frame(host, true);
        await login(hf, 'coophost');
        const newWorker = host.workers().find(worker => worker.url().endsWith('/worker.js'));
        const restored = await newWorker.evaluate(invType => {
            const world = globalThis.__smokeWorld;
            const player = [...world.players].find(player => player.username === 'coophost');
            return {
                xp: player.stats[0],
                coins: player
                    .getInventory(93)
                    .items.filter(item => item?.id === 995)
                    .reduce((sum, item) => sum + item.count, 0),
                shared: [...world.invs].find(inv => inv.type === invType).items[0],
                var0: world.vars[0],
                settings: globalThis.__coop.settings
            };
        }, progress.inventory);
        assert.equal(restored.xp, progress.xp);
        assert(restored.coins >= 123);
        assert.equal(restored.shared.count, 456);
        assert.equal(restored.var0, 345);
        assert.equal(restored.settings.xpRate, 5);
        console.log('PASS: host restart restores XP, items, shared inventories, and settings');
        const nextCode = await host.locator('#roomCode').textContent();
        const returning = await join(guestPages[0], nextCode);
        await login(returning, 'coopone');
        const guestProgress = await newWorker.evaluate(() => {
            const player = [...globalThis.__smokeWorld.players].find(player => player.username === 'coopone');
            return {
                xp: player.stats[0],
                coins: player
                    .getInventory(93)
                    .items.filter(item => item?.id === 995)
                    .reduce((sum, item) => sum + item.count, 0)
            };
        });
        assert.equal(guestProgress.xp, progress.guestXp);
        assert(guestProgress.coins >= 77);
        console.log('PASS: guest character progression survives a host restart');
        await host.locator('#leave').click();
        await host.locator('#solo').click();
        await frame(host, true);
        assert.equal(await host.evaluate(() => window.LoreCoop?.solo), true);
        await host.locator('#leave').click();
        console.log('PASS: room-to-solo transition is isolated from ended-room signaling');
        assert.deepEqual(errors, [], 'Unexpected browser runtime errors');
        console.log('PASS: room closure notifies guests; no unexpected browser runtime errors');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
