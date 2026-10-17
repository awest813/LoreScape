const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const d = require('./gameplay-driver.cjs');
(async () => {
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    try {
        const context = await browser.newContext({serviceWorkers: 'block'});
        const page = await context.newPage();
        page.on('console', m => {
            if (m.type() === 'error') console.error(m.text().slice(0, 1000));
        });
        page.on('response', r => {
            if (r.status() >= 400) console.log('HTTP', r.status(), r.url());
        });
        const errors = await d.open(page, process.env.LORESCAPE_TEST_URL || 'http://localhost:8080');
        await page.locator('#solo').click();
        const f = await d.frame(page).catch(async e => {
            console.log(await page.locator('#notice').textContent());
            throw e;
        });
        await d.login(f, 'perfcheck');
        const measurements = [];
        for (const mode of [
            {fps: 50, hidden: false},
            {fps: 15, hidden: false},
            {fps: 50, hidden: true},
            {fps: 50, hidden: false}
        ]) {
            const result = await f.evaluate(async mode => {
                const g = window.__playGame;
                g.tfps = mode.fps;
                // Exercise the visibility policy deterministically; real OS suspension is browser-controlled.
                Object.defineProperty(document, 'hidden', {configurable: true, get: () => mode.hidden});
                let updates = 0,
                    draws = 0,
                    drawMs = 0;
                const u = g.update,
                    dr = g.draw;
                g.update = async () => {
                    updates++;
                    return u.call(g);
                };
                g.draw = async () => {
                    draws++;
                    const start = performance.now();
                    await dr.call(g);
                    drawMs += performance.now() - start;
                };
                const start = performance.now();
                await new Promise(r => setTimeout(r, 5000));
                const seconds = (performance.now() - start) / 1000;
                g.update = u;
                g.draw = dr;
                return {...mode, updates: updates / seconds, draws: draws / seconds, drawMsPerSecond: drawMs / seconds, ingame: g.ingame, scene: g.sceneState, frameSamples: g.frameTime.filter(Number.isFinite).length};
            }, mode);
            measurements.push(result);
            console.log(JSON.stringify(result));
            assert(result.ingame && result.scene === 2);
            assert(result.updates > 35 && result.updates < 65, JSON.stringify(result));
            assert(result.draws <= (mode.hidden ? 1.5 : mode.fps + 3));
            assert(result.draws >= (mode.hidden ? 0.5 : mode.fps * 0.7));
            assert.equal(result.frameSamples, 50);
        }
        await page.locator('#save').click();
        await page.waitForFunction(() => /progress saved/i.test(document.querySelector('#notice').textContent));
        await page.locator('#leave').click();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify(measurements, null, 2));
        console.log('PASS real gameplay, stable updates, FPS caps, hidden/visible recovery, saves, no JS errors');
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error(e);
    process.exit(1);
});
