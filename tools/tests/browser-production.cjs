const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const bundle = path.resolve(process.env.LORESCAPE_PRODUCTION_DIR || '.local/production-client', 'index.js');
    const source = fs.readFileSync(bundle, 'utf8');
    // Expose the existing game only in the test response, after minification.
    const marker = /\(new ([\w$]+)\)\.run\(\)/;
    assert(marker.test(source), 'Build the optimized co-op client first');
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    try {
        const context = await browser.newContext({serviceWorkers: 'block'});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {if (message.type() === 'error') console.error(message.text().slice(0, 1000));});
        await page.route('**/index.js', route => route.fulfill({contentType: 'text/javascript', body: source.replace(marker, '(window.__smokeGame = new $1).run()')}));
        await page.goto((process.env.LORESCAPE_TEST_URL || 'http://localhost:8080') + '/coop.html');
        await page.evaluate(() => {const panel = document.querySelector('#devicePanel'); if (panel) panel.open = true;});
        await page.locator('#batteryPreset').click();
        await page.locator('#solo').click();
        await page.waitForFunction(() => window.LoreCoop?.ready, null, {timeout: 60000});
        await page.waitForFunction(() => !document.querySelector('#startupPanel') || document.querySelector('#startupPanel').hidden);
        const frame = page.frames().find(frame => frame.url().includes('world=999'));
        await frame.waitForFunction(() => window.__smokeGame?.fontBold12, null, {timeout: 60000});
        assert.equal(await frame.evaluate(() => window.__smokeGame.tfps), 15);
        await frame.evaluate(async () => {
            const game = window.__smokeGame;
            game.username = 'prodcheck';
            game.password = 'private';
            await game.login(game.username, game.password, false);
        });
        await frame.waitForFunction(() => window.__smokeGame.ingame && window.__smokeGame.sceneState === 2, null, {timeout: 40000}).catch(async error => {
            const info = await frame.evaluate(() => {const g = window.__smokeGame; return {ingame:g.ingame, scene:g.sceneState, message:g.loginMessage0 + ' ' + g.loginMessage1, loop:g.loopCycle};});
            throw new Error(`${error.message}: ${JSON.stringify(info)}`);
        });
        await page.locator('#save').click();
        await page.waitForFunction(() => /progress saved/i.test(document.querySelector('#notice').textContent));
        const saved = await page.evaluate(async () => {
            const {SaveStore} = await import('/coop/storage.mjs');
            return Object.keys((await new SaveStore().load(window.LoreCoop.worldId)).data.characters);
        });
        assert.deepEqual(saved, ['prodcheck']);
        await page.locator('#leave').click();
        assert.deepEqual(errors, []);
        console.log('PASS: optimized client preserves lobby/worker APIs, device preferences, login, game loading and character saves');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
