const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const directory = path.resolve(__dirname, '../../public');
    let brokenManifest = false,
        upgrades = 0;
    const mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm'};
    // An isolated static server, deliberately without a room service.
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const name = url.pathname === '/' ? (url.searchParams.has('world') ? '/index.html' : '/coop.html') : decodeURIComponent(url.pathname);
        if (brokenManifest && name === '/offline-assets.json') {
            const manifest = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
            manifest.revision = 'd'.repeat(20);
            manifest.assets[0].sha256 = '0'.repeat(64);
            response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(manifest));
            return;
        }
        const file = path.resolve(directory, '.' + name);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'});
        fs.createReadStream(file).pipe(response);
    });
    server.on('upgrade', (_request, socket) => {
        upgrades++;
        socket.destroy();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://localhost:${server.address().port}`;
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    const errors = [];
    let stopped = false;
    try {
        const context = await browser.newContext({viewport: {width: 1366, height: 768}, acceptDownloads: true});
        await context.addInitScript(() => {
            const original = IDBDatabase.prototype.transaction;
            window.__assetWriteFailures = 0;
            IDBDatabase.prototype.transaction = function (...args) {
                if (this.name === 'lostcity' && args[1] === 'readwrite') {
                    window.__assetWriteFailures++;
                    throw new DOMException('Asset cache full', 'QuotaExceededError');
                }
                return original.apply(this, args);
            };
        });
        const page = await context.newPage();
        page.on('pageerror', error => {
            errors.push(error.stack);
            console.error(error.stack);
        });
        await page.goto(base + '/coop.html');
        await page.waitForFunction(() => document.querySelector('#offlineStatus').textContent.includes('not downloaded'));
        await page.locator('#downloadOffline').click();
        await page
            .waitForFunction(() => document.querySelector('#offlineStatus').textContent.includes('Offline ready') || document.querySelector('#notice').classList.contains('error'), null, {timeout: 180000})
            .catch(async error => {
                console.log('DOWNLOAD FAILURE', await page.locator('#offlineStatus').textContent(), await page.locator('#notice').textContent());
                throw error;
            });
        assert.match(await page.locator('#offlineStatus').textContent(), /Offline ready/, await page.locator('#notice').textContent());
        console.log('PASS: complete offline pack downloaded and verified');
        brokenManifest = true;
        await page.locator('#downloadOffline').click();
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('changed during download'));
        assert.match(await page.locator('#offlineStatus').textContent(), /Offline ready/);
        const retained = await page.evaluate(async () => {
            const {offlineAction} = await import('/coop/offline.mjs');
            return offlineAction('offline-status');
        });
        assert(retained.ready);
        assert.notEqual(retained.revision, 'd'.repeat(20));
        brokenManifest = false;
        console.log('PASS: failed asset verification retains the previous offline pack');
        // Test-only instrumentation in this disposable profile's verified cache.
        await page.evaluate(async () => {
            const cache = await caches.open((await caches.keys()).find(name => name.startsWith('lorescape-assets-v1-')));
            for (const [file, before, after] of [
                ['/index.js', 'new Game().run()', '(window.__smokeGame = new Game()).run()'],
                ['/worker.js', 'self.postMessage({ type: "ready" });', 'globalThis.__smokeWorld = World_default; self.postMessage({ type: "ready" });']
            ]) {
                const response = await cache.match(file);
                const source = await response.text();
                if (!source.includes(before)) throw new Error('Use build:coop development output');
                await cache.put(file, new Response(source.replace(before, after), {headers: response.headers}));
            }
        });
        await new Promise(resolve => server.close(resolve));
        stopped = true;
        await context.setOffline(true);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#offlineStatus').textContent.includes('Offline ready'));
        await page.locator('#batteryPreset').click();
        await page.locator('#worldName').fill('Offline adventure');
        await page.locator('#solo').click();
        const worldId = await page.waitForFunction(() => window.LoreCoop?.worldId).then(handle => handle.jsonValue());
        async function game() {
            await page.waitForFunction(() => document.querySelector('#game').contentWindow.location.search.includes('world=999'));
            const frame = page.frames().find(frame => frame.url().includes('world=999'));
            await frame.waitForFunction(() => window.__smokeGame?.workerReady && window.__smokeGame?.fontBold12, null, {timeout: 60000});
            await page.waitForFunction(() => window.LoreCoop?.ready);
            return frame;
        }
        async function login(frame) {
            await frame.evaluate(async () => {
                const game = window.__smokeGame;
                game.username = 'constructor';
                game.password = 'private';
                await Promise.race([game.login(game.username, game.password, false), new Promise((_, reject) => setTimeout(() => reject(new Error('Offline login timeout')), 30000))]);
            });
            await frame.waitForFunction(() => window.__smokeGame.ingame && window.__smokeGame.sceneState === 2, null, {timeout: 30000});
        }
        let frame = await game();
        await login(frame);
        const otherTab = await context.newPage();
        await otherTab.goto(base + '/coop.html');
        const blockedRemoval = await otherTab.evaluate(async () => {
            const {offlineAction} = await import('/coop/offline.mjs');
            try {
                await offlineAction('offline-remove');
                return false;
            } catch (error) {
                return error.message.includes('End sessions in all');
            }
        });
        assert(blockedRemoval, 'Another tab removed assets while a game was running');
        await otherTab.close();
        console.log('PASS: active sessions prevent offline-file removal from other tabs');
        assert.equal(await frame.evaluate(() => window.__smokeGame.tfps), 15);
        assert(await frame.evaluate(() => window.__assetWriteFailures > 0));
        assert.equal(upgrades, 0);
        console.log('PASS: offline login with server stopped, no signaling, and failed asset-cache writes');
        await page.locator('#fps').selectOption('30');
        await page.locator('#deviceSave').click();
        await frame.waitForFunction(() => window.__smokeGame.tfps === 30);
        await page.setViewportSize({width: 800, height: 700});
        await page.waitForTimeout(100);
        const layout = await page.locator('#game').boundingBox();
        assert(layout.width <= 800);
        assert(layout.width > 500);
        await page.locator('#fullscreen').click();
        assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'gameViewport');
        await page.locator('#exitFullscreen').click();
        await page.waitForFunction(() => !document.fullscreenElement);
        assert.equal(await frame.evaluate(() => window.__smokeGame.deltime), 20);
        console.log('PASS: live FPS, fullscreen and Chromebook window fitting preserve simulation timing');
        const worker = page.workers().find(worker => worker.url().endsWith('/worker.js'));
        const progress = await worker.evaluate(() => {
            const player = [...globalThis.__smokeWorld.players][0];
            player.addXp(0, 1000);
            player.invAdd(93, 995, 42);
            return player.stats[0];
        });
        await frame.locator('#canvas').focus();
        await frame.press('#canvas', 'Control+s');
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('progress saved'));
        await page.locator('#leave').click();
        await page.reload();
        await page.waitForFunction(id => document.querySelector('#worlds').value === id, worldId);
        assert.equal(await page.locator('#worlds').inputValue(), worldId);
        assert.equal(await page.locator('#fps').inputValue(), '30');
        await page.locator('#solo').click();
        frame = await game();
        await login(frame);
        const newWorker = page.workers().find(worker => worker.url().endsWith('/worker.js'));
        const restored = await newWorker.evaluate(() => {
            const player = [...globalThis.__smokeWorld.players][0];
            return {
                xp: player.stats[0],
                coins: player
                    .getInventory(93)
                    .items.filter(item => item?.id === 995)
                    .reduce((sum, item) => sum + item.count, 0)
            };
        });
        assert.equal(restored.xp, progress);
        assert(restored.coins >= 42);
        console.log('PASS: offline restart restores character XP, items, selected world and device preferences');
        await page.evaluate(async () => {
            const {SaveStore} = await import('/coop/storage.mjs');
            window.__originalCommit = SaveStore.prototype.commit;
            SaveStore.prototype.commit = async () => {
                throw new DOMException('Test quota', 'QuotaExceededError');
            };
        });
        await newWorker.evaluate(() => [...globalThis.__smokeWorld.players][0].addXp(0, 500));
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('Storage is full'));
        const downloading = page.waitForEvent('download');
        await page.locator('#sessionExport').click();
        const download = await downloading;
        const archive = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert(Object.hasOwn(archive.snapshot.data.characters, 'constructor'));
        assert.equal(await page.evaluate(() => window.LoreCoop.data.settings.xpRate), 1);
        const rejoinXp = await page.evaluate(async () => {
            const session = window.LoreCoop;
            const postMessage = session.worker.postMessage.bind(session.worker);
            let response;
            session.worker.postMessage = message => {
                if (message.requestId === 'test:rejoin') response = message;
                else postMessage(message);
            };
            try {
                await session.storage({action: 'load-character', name: 'constructor', requestId: 'test:rejoin'});
                await session.saveQueue;
                return new DataView(Uint8Array.from(response.value).buffer).getInt32(28);
            } finally {
                session.worker.postMessage = postMessage;
            }
        });
        assert.equal(rejoinXp, progress + 500, 'Rejoining discarded the pending character save');
        await page.evaluate(async () => {
            const {SaveStore} = await import('/coop/storage.mjs');
            SaveStore.prototype.commit = window.__originalCommit;
        });
        const pendingXp = await page.evaluate(async () => {
            const session = window.LoreCoop;
            await session.storage({action: 'checkpoint', characters: [], requestId: 'test:carry'});
            await session.saveQueue;
            const {SaveStore} = await import('/coop/storage.mjs');
            const store = new SaveStore();
            const data = (await store.load(session.worldId)).data;
            const bytes = store.character(data, 'constructor');
            return new DataView(bytes.buffer).getInt32(28);
        });
        assert.equal(pendingXp, progress + 500);
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('progress saved'));
        console.log('PASS: quota failure is visible, unsaved progress exports, pending characters survive rejoin/retry, and saving recovers');
        await page.screenshot({path: path.resolve(__dirname, '../../.local/offline-solo.png')});
        await page.locator('#leave').click();
        await page.locator('#worldName').fill('Renamed offline world');
        await page.locator('#rename').click();
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('renamed'));
        await page.locator('#delete').click();
        await page.locator('#deleteName').fill('wrong');
        await page.locator('#deleteConfirm').click();
        assert.equal(await page.locator('#deleteDialog').isVisible(), true);
        await page.locator('#deleteName').fill('Renamed offline world');
        await page.locator('#deleteConfirm').click();
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('deleted'));
        assert.equal(await page.locator('#worlds option').count(), 1);
        console.log('PASS: offline world rename and explicit deletion work');
        await page.evaluate(async () => {
            const {SaveStore} = await import('/coop/storage.mjs');
            const store = new SaveStore();
            const world = store.newWorld('Keep my save');
            await store.commit(world);
        });
        await page.locator('#removeOffline').click();
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('download removed'));
        assert.equal(
            await page.evaluate(async () => {
                const {SaveStore} = await import('/coop/storage.mjs');
                return (await new SaveStore().list()).length;
            }),
            1
        );
        console.log('PASS: removing offline files preserves IndexedDB saves');
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
        if (!stopped) await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
