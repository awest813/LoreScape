import http from 'node:http';
import { createReadStream, existsSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { root } from './coop-config.mjs';
import { createSignalingService } from './signaling.mjs';

const directory = realpathSync(path.join(root, 'public'));
const port = Number(process.env.LORESCAPE_PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LORESCAPE_PORT');
for (const file of ['index.js', 'worker.js', 'LoginThread.js', 'data/pack/client/crc']) {
    if (!existsSync(path.join(directory, file))) throw new Error(`Missing ${file}; run npm run setup:coop first.`);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/') {
            if (!url.searchParams.has('world')) { response.writeHead(302, { Location: '/coop.html' }).end(); return; }
        }
        const filename = path.resolve(directory, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!filename.startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
        if (!existsSync(filename) || !statSync(filename).isFile()) { response.writeHead(404).end(); return; }
        if (!realpathSync(filename).startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        if (request.method === 'HEAD') { response.end(); return; }
        const stream = createReadStream(filename);
        stream.on('error', () => response.destroy());
        stream.pipe(response);
    } catch { response.writeHead(400).end(); }
});
const iceServers = process.env.LORESCAPE_ICE_SERVERS ? JSON.parse(process.env.LORESCAPE_ICE_SERVERS) : undefined;
if (iceServers && (!Array.isArray(iceServers) || !iceServers.every(entry => entry && (typeof entry.urls === 'string' || Array.isArray(entry.urls))))) throw new Error('Invalid LORESCAPE_ICE_SERVERS');
const signaling = createSignalingService(server, { iceServers, allowedOrigins: process.env.LORESCAPE_ORIGINS?.split(',') });
server.listen(port, process.env.LORESCAPE_BIND || '127.0.0.1', () => {
    console.log(`Private co-op: http://localhost:${port}/coop.html`);
    console.log('Four players maximum. Host-owned automatic saves. WebRTC with optional relay.');
});
function close() { signaling.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', close); process.on('SIGTERM', close);
