import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, serverDir, serverCommit, serverRepository } from './coop-config.mjs';

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

if (!existsSync(path.join(serverDir, '.git'))) {
    if (existsSync(serverDir)) throw new Error(`Refusing to overwrite ${serverDir}; it is not a Git checkout.`);
    mkdirSync(path.dirname(serverDir), { recursive: true });
    run('git', ['clone', '--no-checkout', serverRepository, serverDir], root);
    run('git', ['checkout', '--detach', serverCommit], serverDir);
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: serverDir, encoding: 'utf8' });
if (revision.status !== 0 || revision.stdout.trim() !== serverCommit) {
    throw new Error(`Expected server ${serverCommit}. Use a fresh checkout; existing work will not be reset.`);
}

// The upstream bundler imports esbuild but omits it from package.json.
const manifestPath = path.join(serverDir, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.devDependencies.esbuild = '0.23.1';
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
copyFileSync(path.join(root, 'tools/locks/server-package-lock.json'), path.join(serverDir, 'package-lock.json'));
run('npm', ['ci', '--no-audit', '--no-fund'], serverDir);
run('npm', ['run', 'build'], serverDir);
if (process.argv.includes('--server-only')) {
    console.log('Pinned server content ready.');
    process.exit(0);
}
run(process.execPath, [path.join(root, 'tools/bundle-coop.mjs')], root);
run('npm', ['run', 'build:coop'], root);
console.log('Co-op ready. Run npm run coop to open the private lobby.');
