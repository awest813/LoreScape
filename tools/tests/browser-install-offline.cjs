const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const directory = path.resolve('public');
    const prefix = '/LoreScape/';
    const mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm'};
    let requests = 0,
        upgrades = 0,
        mode = '';
    const server = http.createServer((request, response) => {
        requests++;
        const url = new URL(request.url, 'http://localhost');
        if (!url.pathname.startsWith(prefix)) return response.writeHead(404).end();
        const name = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
        const file = path.resolve(directory, name.endsWith('/') ? name + 'index.html' : name);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
        if (mode === 'broken' && name === 'offline/offline-assets.json') {
            const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
            manifest.revision = 'd'.repeat(20);
            manifest.assets[0].sha256 = '0'.repeat(64);
            return response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(manifest));
        }
        const send = () => {
            if (response.destroyed) return;
            response.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'});
            fs.createReadStream(file).pipe(response);
        };
        if (mode === 'slow' && name.includes('/data/')) setTimeout(send, 500);
        else send();
    });
    server.on('upgrade', (_request, socket) => {
        upgrades++;
        socket.destroy();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://localhost:${server.address().port}${prefix}`;
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    let stopped = false,
        progressTimer;
    try {
        const failureContext = await browser.newContext();
        const failurePage = await failureContext.newPage();
        await failurePage.route('**/api/v1/worldlist', route => route.fulfill({json: []}));
        await failurePage.goto(base);
        mode = 'slow';
        await failurePage.locator('#install-offline').click();
        await failurePage.locator('#cancelInstall').waitFor({state: 'visible'});
        await failurePage.locator('#cancelInstall').click();
        await failurePage.waitForFunction(() => /Download cancelled/.test(document.querySelector('#notice').textContent));
        assert.equal(await failurePage.evaluate(() => !!window.LoreCoop), false);
        assert.equal(await failurePage.locator('#installOffline').isEnabled(), true);
        mode = 'broken';
        await failurePage.locator('#installOffline').click();
        await failurePage.waitForFunction(() => /changed during download/.test(document.querySelector('#notice').textContent));
        assert.equal(await failurePage.evaluate(() => !!window.LoreCoop), false);
        assert(!/Offline ready/.test(await failurePage.locator('#offlineStatus').textContent()));
        assert.equal((await failurePage.evaluate(() => caches.keys())).filter(name => name.startsWith('lorescape-assets-v1-')).length, 0);
        await failureContext.close();
        mode = '';
        console.log('PASS: cancellation and failed verification keep partial installs unplayable, clean their files, and allow retry');
        const context = await browser.newContext({acceptDownloads: true});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/v1/worldlist', route => route.fulfill({json: []}));
        await page.goto(base);
        await page.evaluate(async () => {
            await caches.open('lorescape-assets-v1-other-app');
        });
        await page.locator('#install-offline').click();
        progressTimer = setInterval(async () => {
            try {
                console.log('Installing:', await page.locator('#offlineStatus').textContent(), await page.locator('#notice').textContent());
            } catch {}
        }, 15000);
        await page
            .waitForFunction(() => window.LoreCoop?.characterName === 'adventurer' || document.querySelector('#notice').classList.contains('error'), null, {timeout: 180000})
            .catch(async error => {
                console.error(
                    'INSTALL',
                    await page.locator('#notice').textContent(),
                    await page.locator('#offlineStatus').textContent(),
                    page.frames().map(frame => frame.url()),
                    errors
                );
                throw error;
            });
        clearInterval(progressTimer);
        assert.equal(await page.evaluate(() => document.querySelector('#notice').classList.contains('error')), false, await page.locator('#notice').textContent());
        assert.match(await page.locator('#offlineStatus').textContent(), /Offline ready/);
        await page.locator('#save').click();
        await page.waitForFunction(() => /progress saved/i.test(document.querySelector('#notice').textContent));
        const worldId = await page.evaluate(() => window.LoreCoop.worldId);
        const saved = await page.evaluate(async id => {
            const {SaveStore} = await import('./coop/storage.mjs');
            return Object.keys((await new SaveStore().load(id)).data.characters);
        }, worldId);
        assert.deepEqual(saved, ['adventurer']);
        assert.equal(upgrades, 0, 'Offline solo must not require a room service');
        assert(await page.evaluate(() => caches.has('lorescape-assets-v1-other-app')), 'Install must preserve other app caches');
        const registration = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration(location.href)).scope);
        assert.equal(registration, base + 'offline/');
        console.log('PASS: one launcher click installs the verified complete pack in a GitHub Pages subdirectory and enters a playable character without an account or server');
        await page.locator('#leave').click();
        await page.locator('#lobby').waitFor({state: 'visible'});
        // Inspect gameplay only in this disposable profile, after real installation succeeds.
        await page.evaluate(async () => {
            const {offlineAction} = await import('./coop/offline.mjs');
            const status = await offlineAction('offline-status');
            const key = new URL('index.js', location.href).href;
            for (const name of await caches.keys()) {
                if (!name.startsWith('lorescape-assets-v1-')) continue;
                const cache = await caches.open(name);
                const response = await cache.match(key);
                if (!response) continue;
                const source = await response.text();
                const marker = /\(new ([\w$]+)\)\.run\(\)/;
                if (!marker.test(source)) throw new Error('Optimized game bootstrap missing');
                await cache.put(key, new Response(source.replace(marker, '(window.__offlineGame = new $1).run()'), {headers: response.headers}));
            }
            if (!status.ready) throw new Error('Installed pack is incomplete');
        });
        await new Promise(resolve => server.close(resolve));
        stopped = true;
        const previousRequests = requests;
        await context.setOffline(true);
        await page.goto(base);
        await page.waitForURL(base + 'offline/coop.html');
        await page.waitForFunction(() => document.querySelector('#installOffline').textContent === 'Play offline');
        await page.locator('#installOffline').click();
        await page.waitForFunction(() => window.LoreCoop?.characterName === 'adventurer', null, {timeout: 90000});
        assert.equal(await page.evaluate(() => window.LoreCoop.worldId), worldId);
        const game = page.frames().find(frame => frame.url().includes('world=999'));
        await game.waitForFunction(() => window.__offlineGame?.ingame && window.__offlineGame.sceneState === 2, null, {timeout: 45000});
        await page.locator('#save').click();
        await page.waitForFunction(() => /progress saved/i.test(document.querySelector('#notice').textContent));
        assert.equal(requests, previousRequests);
        await page.locator('#leave').click();
        await page.locator('#lobby').waitFor({state: 'visible'});
        // Removing files must retain worlds and other applications' caches.
        await page.locator('#devicePanel').evaluate(panel => {
            panel.open = true;
        });
        await page.locator('#removeOffline').click();
        await page.waitForFunction(() => /download removed/.test(document.querySelector('#notice').textContent) || document.querySelector('#notice').classList.contains('error'));
        assert.match(await page.locator('#notice').textContent(), /download removed/);
        assert.equal(await page.locator('#worlds').inputValue(), worldId);
        assert(await page.evaluate(() => caches.has('lorescape-assets-v1-other-app')));
        assert.deepEqual(errors, []);
        console.log('PASS: usual launcher address, same character, real gameplay and saving work with the HTTP server stopped; removal keeps saves and unrelated caches');
    } finally {
        clearInterval(progressTimer);
        await browser.close();
        if (!stopped) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
