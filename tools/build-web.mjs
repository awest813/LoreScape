import {existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync, copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {root, serverDir} from './coop-config.mjs';
import {verifyWebBuild} from './verify-web.mjs';

const pages = process.argv.includes('--pages');
const mode = pages || process.argv.includes('--solo') ? 'solo' : 'coop';
const staging = path.join(root, '.local', `web-build-${process.pid}`);
const output = path.join(root, pages ? 'public/offline' : 'dist');
function run(args, env = {}) {
    const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit', env: {...process.env, ...env}});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Build step failed: ${args[0]} (${result.status})`);
}
if (!existsSync(path.join(serverDir, 'data/pack/server/script.dat'))) {
    throw new Error('Packed server content is missing. Run npm run setup:coop first (Node 22+, Java 17+, Git).');
}
mkdirSync(staging, {recursive: true});
try {
    run(['tools/bundle-coop.mjs'], {LORESCAPE_BUNDLE_DIR: staging});
    run(['node_modules/assemblyscript/bin/asc.js', '--target', 'release', '--optimizeLevel', '3', '--converge']);
    run(['node_modules/webpack-cli/bin/cli.js', '--mode=production', '--node-env=production', '--env', 'coop', '--output-path', staging]);
    if (mode === 'solo') {
        for (const file of ['coop.html', 'coop/lobby.mjs', 'coop/style.css']) copyFileSync(path.join(root, 'src/solo', file), path.join(staging, file));
    }
    writeFileSync(path.join(staging, 'hosting-mode.json'), JSON.stringify({version: 1, mode}) + '\n');
    run(['tools/offline-manifest.mjs', staging, '--strict']);
    // Upstream also copies editor/map-viewer packs; ship only the game allowlist.
    const keep = new Set(JSON.parse(readFileSync(path.join(staging, 'offline-assets.json'), 'utf8')).assets.map(asset => asset.url.slice(1)));
    for (const filename of ['offline-assets.json', 'offline-sw.js', 'hosting-mode.json']) keep.add(filename);
    function prune(relative = '') {
        for (const entry of readdirSync(path.join(staging, relative), {withFileTypes: true})) {
            const filename = path.posix.join(relative, entry.name);
            if (entry.isDirectory()) prune(filename);
            else if (!keep.has(filename)) rmSync(path.join(staging, filename));
        }
    }
    prune();
    const report = verifyWebBuild(staging);
    // Replace the last complete package only after all build steps and checks pass.
    const previous = output + '.previous';
    rmSync(previous, {recursive: true, force: true});
    if (existsSync(output)) renameSync(output, previous);
    try { renameSync(staging, output); }
    catch (error) { if (existsSync(previous)) renameSync(previous, output); throw error; }
    rmSync(previous, {recursive: true, force: true});
    console.log(`Web package ready: ${path.relative(root, output)} (${mode}, ${report.assets} checked assets, ${(report.bytes / 1048576).toFixed(1)} MiB). ${pages ? 'Serve public/ with your Pages host.' : 'Run npm start.'}`);
} finally {
    rmSync(staging, {recursive: true, force: true});
}
