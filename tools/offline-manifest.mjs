import {readdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './coop-config.mjs';

const directory = path.resolve(process.argv[2] || path.join(root, 'public'));
const required = ['coop.html', 'index.html', 'index.js', 'worker.js', 'LoginThread.js', 'FriendThread.js', 'manifest.json', 'manifest.png', 'favicon.ico', 'SCC1_Florestan.sf2', 'data/config/private.pem'];
if (!required.every(file => existsSync(path.join(directory, file)))) {
    if (process.argv.includes('--strict')) throw new Error('Offline pack incomplete: missing required client or server assets');
    console.log('Offline manifest deferred: finish client and server builds first.');
} else {
    const files = new Set(required);
    function collect(relative) {
        for (const entry of readdirSync(path.join(directory, relative), {withFileTypes: true})) {
            const file = path.posix.join(relative, entry.name);
            if (entry.isDirectory()) collect(file);
            else if (entry.isFile()) files.add(file);
        }
    }
    collect('coop');
    collect('data/pack/client');
    collect('data/pack/server');
    for (const entry of readdirSync(directory)) if (/\.(?:wasm|css)$/.test(entry)) files.add(entry);
    const assets = [...files].sort().map(file => {
        const bytes = readFileSync(path.join(directory, file));
        return {url: '/' + file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    });
    const revision = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 20);
    writeFileSync(path.join(directory, 'offline-assets.json'), JSON.stringify({version: 1, revision, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), assets}));
    console.log(`Offline pack: ${assets.length} files, ${(assets.reduce((sum, asset) => sum + asset.bytes, 0) / 1048576).toFixed(1)} MiB, revision ${revision}`);
}
