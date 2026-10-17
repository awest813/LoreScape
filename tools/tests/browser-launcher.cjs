const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {crc32} = require('node:zlib');

(async () => {
    const root = path.resolve(__dirname, '../../public');
    const fixture = readFileSync(path.resolve(__dirname, '../../test/resources/title'));
    const checksum = crc32(fixture) | 0;
    const crc = Buffer.alloc(36);
    for (let i = 1; i <= 8; i++) crc.writeInt32BE(checksum, i * 4);
    const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml'};
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const relative = url.pathname.startsWith('/LoreScape/') ? url.pathname.slice('/LoreScape/'.length) : url.pathname.slice(1);
        const file = path.resolve(root, relative || 'index.html');
        if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
        try { response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}).end(readFileSync(file)); }
        catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    const errors = [];
    try {
        browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
        const context = await browser.newContext({acceptDownloads: true});
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        let directory = 'valid', holdTitle = false, heldTitle, localChecks = 0, localAvailable = false;
        let titleHeld;
        const titleRequest = new Promise(resolve => { titleHeld = resolve; });
        const worlds = [1, 2].map(id => ({id, address: 'https://world.example', portOffset: 0, region: 'Fixture', players: 12, members: id === 2}));
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/v1/worldlist') return route.fulfill({json: directory === 'valid' ? worlds : directory === 'empty' ? [] : {error: 'Unavailable'}});
            if (url.origin === origin && url.pathname === '/crc') {
                localChecks++;
                return route.fulfill({status: localAvailable ? 200 : 503, body: localAvailable ? crc : 'Server unavailable'});
            }
            if (url.hostname === 'world.example') {
                if (url.pathname === '/crc') return route.fulfill({body: crc});
                if (holdTitle && url.pathname.startsWith('/title')) { heldTitle = route; titleHeld(); return; }
                return route.fulfill({body: fixture});
            }
            return url.origin === origin ? route.continue() : route.abort();
        });
        await page.goto(origin + '/LoreScape/');
        await page.locator('.world-option').last().waitFor();
        for (directory of ['empty', 'invalid']) {
            await page.locator('#refresh-worlds').click();
            await page.waitForFunction(() => !document.querySelector('#refresh-worlds').disabled);
            assert.equal(await page.locator('.world-option').count(), 2);
            assert.match(await page.locator('#world-notice').textContent(), /last fetched/);
            assert.equal(await page.locator('#refresh-worlds').evaluate(element => element === document.activeElement), true);
        }
        await page.locator('.world-option[data-world="2"]').focus();
        await page.keyboard.press('Space');
        assert.equal(await page.locator('#world').inputValue(), '2');
        assert.equal(await page.locator('.world-option[data-world="2"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.world-option[data-world="2"]').evaluate(element => getComputedStyle(element).outlineOffset), '-3px');
        await page.locator('#cache-export summary').click();
        await page.locator('#cache-format').selectOption('core');
        directory = 'valid';
        holdTitle = true;
        await page.locator('#download-cache').click();
        await page.waitForFunction(() => document.querySelector('#cache-download-status').textContent.includes('1 of 8'));
        await titleRequest;
        await page.locator('#world-filter').selectOption('free');
        assert.equal(await page.locator('#cancel-cache-download').isVisible(), true);
        assert.equal(await page.locator('#download-cache').isDisabled(), true);
        const downloaded = page.waitForEvent('download');
        holdTitle = false;
        assert(heldTitle, 'The cache request must still be pending');
        await heldTitle.fulfill({body: fixture});
        assert.equal((await downloaded).suggestedFilename(), 'lorescape-world-2-core-cache.zip');
        await page.waitForFunction(() => !document.querySelector('#download-cache').disabled);
        console.log('PASS: invalid/empty directories retain the previous list, refresh restores focus, world selection works by keyboard, and filtering preserves the selected-world cache download');

        await page.locator('#local-worlds summary').click();
        await page.locator('.local-world-option[data-world="0"]').click();
        await page.locator('#local-address').fill(origin);
        await page.evaluate(() => { window.__launcherSentinel = 'preserve this page'; });
        await page.locator('#launch-button').click();
        const retry = page.getByRole('button', {name: 'Check world again'});
        await retry.waitFor();
        const previousChecks = localChecks;
        await page.locator('input[name="detail"][value="low"]').check();
        await retry.click();
        await page.waitForFunction(() => !document.querySelector('#launch-button').disabled);
        assert(localChecks > previousChecks);
        assert.equal(await page.evaluate(() => window.__launcherSentinel), 'preserve this page');
        assert.equal(await page.locator('input[name="detail"][value="low"]').isChecked(), true);
        assert.equal(await retry.evaluate(element => element === document.activeElement), true);
        assert.equal(await page.locator('#client-stage').isVisible(), false);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({width, height: 900});
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
        }
        console.log('PASS: local startup retries preserve the page and edited graphics, restore keyboard focus, and fit mobile, Chromebook and desktop widths');
        // Fail the lazy game chunk deliberately so navigation is verified without a live server.
        await page.route('**/game-client.*.js', route => route.abort());
        localAvailable = true;
        await retry.click();
        await page.locator('#client-stage').waitFor();
        assert.equal(new URL(page.url()).searchParams.get('world'), '0');
        assert.equal(new URL(page.url()).searchParams.get('detail'), 'low');
        assert.equal(await page.evaluate(() => window.__launcherSentinel), 'preserve this page');
        assert.equal(await page.locator('.launcher-header nav a').first().getAttribute('href'), '#client-stage');
        assert.equal(await page.locator('.launcher-skip').getAttribute('href'), '#canvas');
        await page.locator('.launcher-skip').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#canvas').evaluate(element => element === document.activeElement), true);
        let roomBundle = false, workerAvailable = false;
        await page.route('**/browser-world.json', route => route.fulfill({status: roomBundle ? 200 : 404, json: roomBundle ? {version: 1, kind: 'lorescape-coop'} : {}}));
        await page.route('**/worker.js', route => route.fulfill({status: workerAvailable ? 200 : 404, contentType: 'application/javascript', body: '// fixture worker'}));
        await page.route('**/data/pack/client/crc', route => route.fulfill({body: crc}));
        await page.route('**/coop.html', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><h1>Room lobby</h1>'}));
        await page.goto(origin + '/LoreScape/?world=999');
        await page.getByRole('button', {name: 'Check world again'}).waitFor();
        assert.match(await page.locator('#lore-status-message').textContent(), /worker.js/);
        assert.equal(await page.locator('#client-stage').isVisible(), false);
        await page.addInitScript(() => Object.defineProperty(window, 'RTCPeerConnection', {configurable: true, value: undefined}));
        await page.goto(origin + '/LoreScape/?world=998');
        await page.getByRole('button', {name: 'Check world again'}).waitFor();
        assert.match(await page.locator('#lore-status-message').textContent(), /WebRTC/);
        roomBundle = true;
        await page.goto(origin + '/LoreScape/?world=999');
        await page.getByRole('button', {name: 'Check world again'}).waitFor();
        assert.match(await page.locator('#lore-status-message').textContent(), /website root/);
        await page.goto(origin + '/?world=999');
        await page.getByRole('button', {name: 'Check world again'}).waitFor();
        assert.match(await page.locator('#lore-status-message').textContent(), /worker.js/);
        workerAvailable = true;
        for (const [world, target] of [[999, 'host'], [998, 'join']]) {
            await page.goto(origin + '/?world=' + world);
            await page.waitForURL('**/coop.html#' + target);
            assert.equal(await page.locator('h1').textContent(), 'Room lobby');
        }
        console.log('PASS: missing browser bundles recover clearly; installed room bundles route hosting/joining to their lobby even without WebRTC');
        assert.deepEqual(errors, []);
        console.log('PASS: Play targets the visible client and Skip to game focuses its canvas; no uncaught browser errors');
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
