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
console.log(`Pages validation passed: ${pages.length} entry points, relative assets, manifest, and WebAssembly.`);
