import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, serverDir, serverCommit } from './coop-config.mjs';
import {writeClientCrc} from './client-crc.mjs';

const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: serverDir, encoding: 'utf8' });
if (revision.status !== 0 || revision.stdout.trim() !== serverCommit) throw new Error('Server revision does not match the pinned baseline.');
const output = path.resolve(process.env.LORESCAPE_BUNDLE_DIR || path.join(root, 'public')) + path.sep;
const adapter = path.join(serverDir, '.lorescape-bundle.mjs');
let source = readFileSync(path.join(serverDir, 'bundle.js'), 'utf8');
const target = "const outDir = '../Client2/public/';";
if (!source.includes(target)) throw new Error('Upstream bundle layout changed.');
source = source.replace(target, `const outDir = ${JSON.stringify(output)};`);
source = source.replace('console.error(e);', 'throw e;');
// Do not strip the wasm-bindgen variable named "imports" along with imports.
source = source.replace("line.startsWith('import')", "line.startsWith('import ')");
source = `import { browserPathfinder } from ${JSON.stringify(path.join(root, 'tools/pathfinder-browser.mjs'))};\n` + source;
source = `import { coopServer } from ${JSON.stringify(path.join(root, 'tools/server-coop-adapter.mjs'))};\n` + source;
source = source.replace('bundle: true,', 'bundle: true,\n        plugins: [coopServer, browserPathfinder],');
// Keep the URL expected by the browser while copying the npm package's actual file.
source = source.replace("outDir + basename(file);", "outDir + basename(file).replace('_bg.wasm', '.wasm');");
source = source.replace('dist/rsmod-pathfinder.wasm', 'dist/rsmod-pathfinder_bg.wasm');
source = source.replace("const esbuildExternals = [", "const esbuildExternals = ['zlib', ");
source = source.replace('const defines = {', "const defines = {\n    'process.env': '{}',");
source = source.replace("'kleur', ", '');
writeFileSync(adapter, source);
try {
    const result = spawnSync(process.execPath, [adapter], { cwd: serverDir, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Server bundling failed (${result.status})`);
} finally {
    rmSync(adapter, { force: true });
}
// Upstream always creates this worker but does not bundle it. Its public-world
// friends backend requires a separate Node/WebSocket service. Private sessions
// use local chat; discard backend messages until a local party system is added.
writeFileSync(path.join(output, 'FriendThread.js'), 'self.onmessage = () => {};\n');
// Upstream initializes CRCs before packing archives on the first clean build,
// leaving an all-zero table that the live worker rejects during character login.
writeClientCrc(output);
writeFileSync(path.join(output, 'browser-world.json'), JSON.stringify({version: 1, kind: 'lorescape-coop'}) + '\n');
for (const file of ['worker.js', 'LoginThread.js', 'FriendThread.js', 'bzip2.wasm', 'rsmod-pathfinder.wasm', 'data/pack/client/crc']) {
    if (!existsSync(path.join(output, file))) throw new Error(`Bundle missing ${file}`);
}
console.log(`Browser server bundle copied to ${output}.`);
