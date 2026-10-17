const fs = require('node:fs');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {generateKeyPairSync} = require('node:crypto');

const revision = '647886c42f8a22c0f18e5dbe79c2697f052f8d2e';
const root = __dirname;
const server = path.join(root, 'server');
function run(command, args, cwd = root) {
    execFileSync(command, args, {cwd, stdio: 'inherit'});
}
try {
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && (minor < 22 || (minor === 22 && patch < 1)))) throw new Error('Install Node.js 22.22.1 or later, then retry.');
    run('git', ['--version']);
    const java = spawnSync('java', ['-version'], {encoding: 'utf8'});
    const javaVersion = /version "(\d+)/.exec(java.stderr || java.stdout || '');
    if (java.error || java.status !== 0 || !javaVersion || Number(javaVersion[1]) < 17) throw new Error('Install Java 17 or later, then retry.');
    console.log('Installing the pinned 2004Scape server. Keep this terminal open.');
    if (!fs.existsSync(server)) {
        fs.mkdirSync(server);
        run('git', ['init', '.'], server);
        run('git', ['remote', 'add', 'origin', 'https://github.com/2004scape/Server.git'], server);
    }
    const current = fs.existsSync(path.join(server, 'package.json'))
        ? execFileSync('git', ['rev-parse', 'HEAD'], {cwd: server, encoding: 'utf8'}).trim() : '';
    if (current && current !== revision) throw new Error('This server folder uses another revision. Extract this kit to a new folder; your existing server was left untouched.');
    if (!current) {
        run('git', ['fetch', '--depth=1', 'origin', revision], server);
        run('git', ['checkout', '--detach', 'FETCH_HEAD'], server);
    }
    if (!fs.existsSync(path.join(root, '.installed'))) {
        // Private development services must not listen on every network interface.
        for (const name of ['src/web.ts', 'src/server/tcp/TcpServer.ts']) {
            const filename = path.join(server, name);
            fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replaceAll("'0.0.0.0'", "'127.0.0.1'"));
        }
    }
    // The upstream development key is too small for normal login credentials.
    // Generate a private installation key once; never publish it in the client ZIP.
    const keyMarker = path.join(root, '.server-key');
    if (!fs.existsSync(keyMarker)) {
        const keys = generateKeyPairSync('rsa', {modulusLength: 1024, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs1', format: 'pem'}});
        fs.writeFileSync(path.join(server, 'data/config/private.pem'), keys.privateKey, {mode: 0o600});
        fs.chmodSync(path.join(server, 'data/config/private.pem'), 0o600);
        fs.writeFileSync(path.join(server, 'data/config/public.pem'), keys.publicKey);
        fs.writeFileSync(keyMarker, 'Installation-specific login key. Keep the server folder private.\n');
    }
    const env = path.join(server, '.env');
    if (!fs.existsSync(env)) fs.writeFileSync(env, 'WEB_PORT=8888\nWEB_MANAGEMENT_PORT=8898\nNODE_PORT=43594\nNODE_ID=10\nNODE_PRODUCTION=false\nNODE_DEBUG=false\nLOGIN_SERVER=false\nFRIEND_SERVER=false\nLOGGER_SERVER=false\nWEBSITE_REGISTRATION=false\n');
    const packageFile = path.join(server, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    // Remove the legacy native installer/tar chain and patch SQL-builder advisories.
    manifest.dependencies.bcrypt = '6.0.0';
    manifest.dependencies.kysely = '0.28.17';
    fs.writeFileSync(packageFile, JSON.stringify(manifest, null, 2) + '\n');
    if (!fs.existsSync(path.join(server, 'package-lock.json'))) fs.copyFileSync(path.join(root, 'server-package-lock.json'), path.join(server, 'package-lock.json'));
    if (process.platform === 'win32') run('cmd.exe', ['/d', '/s', '/c', 'npm ci --include=dev --no-fund --no-audit'], server);
    else run('npm', ['ci', '--include=dev', '--no-fund', '--no-audit'], server);
    fs.writeFileSync(path.join(root, '.installed'), revision + '\n');
    console.log('Setup complete. Run: node start.cjs');
} catch (error) {
    console.error('Setup did not finish:', error.message);
    console.error('Requires Git, Node.js 22.22.1+, Java 17+, and internet access. Linux may also need Python 3, make and a C++ compiler for native packages. Retry node setup.cjs after fixing the error.');
    process.exitCode = 1;
}
