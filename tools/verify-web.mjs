import {readFileSync, readdirSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {clientCrcTable} from './client-crc.mjs';

export function verifyWebBuild(directory) {
    const base = realpathSync(directory);
    const manifest = JSON.parse(readFileSync(path.join(base, 'offline-assets.json'), 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw new Error('Invalid offline manifest');
    const urls = new Set();
    let bytes = 0;
    for (const asset of manifest.assets) {
        if (typeof asset.url !== 'string' || !asset.url.startsWith('/') || urls.has(asset.url)) throw new Error('Invalid or duplicate asset URL');
        const filename = realpathSync(path.resolve(base, '.' + asset.url));
        if (!filename.startsWith(base + path.sep)) throw new Error('Asset escapes build directory');
        const content = readFileSync(filename);
        if (content.length !== asset.bytes || createHash('sha256').update(content).digest('hex') !== asset.sha256) throw new Error(`Asset integrity failed: ${asset.url}`);
        urls.add(asset.url);
        bytes += content.length;
    }
    if (manifest.bytes !== bytes || manifest.revision !== createHash('sha256').update(JSON.stringify(manifest.assets)).digest('hex').slice(0, 20)) throw new Error('Offline manifest totals or revision mismatch');
    for (const file of ['/index.html', '/coop.html', '/index.js', '/worker.js', '/LoginThread.js', '/bz2.wasm', '/bzip2.wasm', '/rsmod-pathfinder.wasm', '/data/pack/client/crc', '/data/pack/server/script.dat']) {
        if (!urls.has(file)) throw new Error(`Required game asset missing: ${file}`);
    }
    readFileSync(path.join(base, 'offline-sw.js'));
    if (!readFileSync(path.join(base, 'data/pack/client/crc')).equals(clientCrcTable(base))) throw new Error('Client archive CRC table is stale; rebuild the browser server bundle');
    function check(relative = '') {
        for (const entry of readdirSync(path.join(base, relative), {withFileTypes: true})) {
            const file = path.posix.join(relative, entry.name);
            if (entry.isSymbolicLink() || entry.name.startsWith('.') || /^(players|saves|backups)$/i.test(entry.name)) throw new Error(`Runtime/private data in build: ${file}`);
            if (entry.isDirectory()) check(file);
            else if (!urls.has('/' + file) && !['offline-assets.json', 'offline-sw.js', 'hosting-mode.json'].includes(file)) throw new Error(`Unlisted build file: ${file}`);
        }
    }
    check();
    return {assets: urls.size, bytes};
}
