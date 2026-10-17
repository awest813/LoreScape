import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { root } from './coop-config.mjs';
import { createSignalingService } from './signaling.mjs';
import {createWebServer} from './web-server.mjs';
import {verifyWebBuild} from './verify-web.mjs';

const production = process.argv.includes('--production');
const target = path.join(root, production ? 'dist' : 'public');
if (!existsSync(target)) throw new Error(`Missing ${target}; run npm run ${production ? 'build:web' : 'setup:coop'} first.`);
const directory = realpathSync(target);
const mode = production ? JSON.parse(readFileSync(path.join(directory, 'hosting-mode.json'), 'utf8')).mode : 'coop';
if (!['solo', 'coop'].includes(mode)) throw new Error('Invalid hosting mode');
if (production) verifyWebBuild(directory);
const port = Number(process.env.LORESCAPE_PORT || process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LORESCAPE_PORT');
for (const file of ['index.js', 'worker.js', 'LoginThread.js', 'data/pack/client/crc']) {
    if (!existsSync(path.join(directory, file))) throw new Error(`Missing ${file}; run npm run setup:coop first.`);
}
const server = createWebServer(directory);
const iceServers = process.env.LORESCAPE_ICE_SERVERS ? JSON.parse(process.env.LORESCAPE_ICE_SERVERS) : undefined;
if (iceServers && (!Array.isArray(iceServers) || !iceServers.every(entry => entry && (typeof entry.urls === 'string' || Array.isArray(entry.urls))))) throw new Error('Invalid LORESCAPE_ICE_SERVERS');
const signaling = mode === 'coop' ? createSignalingService(server, { iceServers, allowedOrigins: process.env.LORESCAPE_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) }) : null;
if (!signaling) server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'));
server.on('error', error => { console.error(`Hosting failed: ${error.message}`); signaling?.close(); process.exit(1); });
server.listen(port, process.env.LORESCAPE_BIND || '127.0.0.1', () => {
    console.log(`LoreScape ${mode}: http://localhost:${port}/coop.html (${production ? 'production dist' : 'development public'})`);
    console.log(mode === 'coop' ? 'Four players maximum. Host-owned automatic saves. WebRTC with optional relay.' : 'Solo browser simulation. Local saves. No room service.');
});
function close() {
    const deadline = setTimeout(() => process.exit(0), 5000);
    deadline.unref(); signaling?.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', close); process.on('SIGTERM', close);
