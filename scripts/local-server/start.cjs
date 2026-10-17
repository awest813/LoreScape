const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {createGateway} = require('./gateway.cjs');
const server = path.join(__dirname, 'server');
try {
    if (!fs.existsSync(path.join(__dirname, '.installed'))) throw new Error('Run node setup.cjs first.');
    const publicOrigin = process.env.LORESCAPE_PUBLIC_ORIGIN;
    if (publicOrigin) {
        const url = new URL(publicOrigin);
        if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password) throw new Error('LORESCAPE_PUBLIC_ORIGIN must be an HTTPS origin, without a trailing slash.');
    }
    const gateway = createGateway({client: path.join(__dirname, 'client'), server, publicOrigin});
    let child;
    let stopping = false;
    function stop() {
        if (stopping) return;
        stopping = true;
        gateway.close();
        if (child && child.exitCode === null) {
            console.log('Stopping the world and saving players. Wait for Server shutdown complete before closing this terminal.');
            // Windows delivers terminal Ctrl+C to both processes. child.kill()
            // would terminate it immediately there, skipping the save procedure.
            if (process.platform !== 'win32') child.kill('SIGINT');
        }
    }
    gateway.on('error', error => { console.error(`Launcher failed: ${error.message}. Port 8080 may be in use.`); process.exitCode = 1; stop(); });
    gateway.listen(8080, process.env.LORESCAPE_HOST || '127.0.0.1', () => {
        console.log('Starting game server. First launch packs game data and can take several minutes.');
        console.log(`When the server reports startup complete, open ${publicOrigin || 'http://127.0.0.1:8080'}/`);
        child = spawn(process.execPath, ['--import', 'tsx', 'src/app.ts'], {cwd: server, stdio: ['inherit', 'pipe', 'inherit'], env: {...process.env, WEB_PORT: '8888', WEB_MANAGEMENT_PORT: '8898', NODE_PORT: '43594'}});
        createInterface({input: child.stdout}).on('line', line => {
            console.log(line);
            if (line.includes('World ready')) console.log(`LoreScape ready: open ${publicOrigin || 'http://127.0.0.1:8080'}/`);
        });
        child.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
        child.on('exit', code => { if (!stopping) { process.exitCode = code || 0; stop(); } });
    });
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
} catch (error) { console.error(error.message); process.exitCode = 1; }
