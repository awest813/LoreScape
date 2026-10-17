const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../public');
const pages = ['index', 'playground', 'viewer', 'mesanim', 'items', 'sounds', 'interface-editor', 'JagEd', 'mapview'];
for (const page of pages) {
    const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
    assert.match(html, /<!doctype html>/i, `${page} needs standards mode`);
    assert.match(html, /lang="en"/, `${page} needs a document language`);
    const assets = [...html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    assert(assets.some(asset => asset.endsWith('.js')), `${page} has no scripts`);
    for (const asset of assets) {
        assert(!asset.startsWith('/'), `${page}: root-relative asset breaks project Pages: ${asset}`);
        if (/^(?:https?:|data:)/.test(asset)) continue;
        assert(fs.existsSync(path.join(root, asset)), `${page}: missing asset ${asset}`);
    }
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.scope, './');
assert.equal(manifest.id, './');
for (const icon of manifest.icons) {
    assert(!icon.src.startsWith('/'));
    assert(fs.existsSync(path.join(root, icon.src)));
}
assert(fs.existsSync(path.join(root, '.nojekyll')));
assert(WebAssembly.validate(fs.readFileSync(path.join(root, 'bz2.wasm'))));
const setup = fs.readFileSync(path.join(root, 'local-setup.html'), 'utf8');
assert.match(setup, /id="chromebook"/);
assert.match(setup, /lorescape-local-server\.zip/);
const kit = fs.readFileSync(path.join(root, 'lorescape-local-server.zip'));
assert.equal(kit.readUInt32LE(), 0x04034b50, 'Local setup download must be a ZIP');
assert(kit.includes(Buffer.from('LoreScape-local-server/setup.cjs')));
assert(kit.includes(Buffer.from('LoreScape-local-server/client/index.html')));
assert(!kit.includes(Buffer.from('private.pem')), 'A setup download must never include private keys');
console.log(`Pages validation passed: ${pages.length} entry points, relative assets, manifest, and WebAssembly.`);

const offlineDirectory = path.join(root, 'offline');
if (process.argv.includes('--offline')) assert(fs.existsSync(offlineDirectory), 'Pages deployment requires the complete offline package');
if (fs.existsSync(offlineDirectory)) {
    const offlineHtml = fs.readFileSync(path.join(offlineDirectory, 'coop.html'), 'utf8');
    assert.match(offlineHtml, /id="installOffline"/);
    assert(!/(?:src|href)="\//.test(offlineHtml), 'Offline launcher assets must support project subdirectories');
    const offlineManifest = JSON.parse(fs.readFileSync(path.join(offlineDirectory, 'manifest.json'), 'utf8'));
    assert.equal(offlineManifest.scope, './');
    assert.equal(offlineManifest.start_url, './coop.html');
    import('../tools/verify-web.mjs').then(({verifyWebBuild}) => {
        const result = verifyWebBuild(offlineDirectory);
        console.log(`Offline Pages package verified: ${result.assets} assets, ${(result.bytes / 1048576).toFixed(1)} MiB.`);
    }).catch(error => { console.error(error); process.exitCode = 1; });
}
