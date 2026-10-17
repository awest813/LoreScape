const http = require('node:http');
const https = require('node:https');
const {WebSocket} = require('ws');
const {HttpsProxyAgent} = require('https-proxy-agent');
const {getProxyForUrl} = require('proxy-from-env');
const {WORLD_LIST_URL, worldAddresses} = require('../src/js/connection.ts');

const args = process.argv.slice(2);
function option(name, fallback) {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}.`);
    return args[index + 1];
}
const origin = new URL(option('--origin', 'https://awest813.github.io')).origin;
const id = Number(option('--world', '1'));
const directory = option('--directory', WORLD_LIST_URL);
if (!Number.isInteger(id) || id < 1 || id > 997) throw new Error('Choose a live world ID between 1 and 997.');

function agentFor(url) {
    const proxy = getProxyForUrl(url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
    return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

function download(address, redirects = 0) {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return Promise.reject(new Error('Invalid server URL.'));
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.get(url, {agent: agentFor(url.href), headers: {Origin: origin}}, response => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                if (redirects >= 3) { reject(new Error('Too many redirects.')); return; }
                const next = new URL(response.headers.location, url);
                if (url.protocol === 'https:' && next.protocol !== 'https:') { reject(new Error('The server redirects HTTPS to an insecure URL.')); return; }
                download(next.href, redirects + 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode} from ${url.origin}${url.pathname}`)); return; }
            const allowed = response.headers['access-control-allow-origin'];
            if (allowed !== '*' && allowed !== origin) { response.resume(); reject(new Error(`The server does not allow browser downloads from ${origin} (CORS).`)); return; }
            const chunks = [];
            let length = 0;
            response.on('data', chunk => {
                length += chunk.length;
                if (length > 1024 * 1024) { request.destroy(new Error('Unexpectedly large server response.')); return; }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        const deadline = setTimeout(() => request.destroy(new Error(`Request timed out: ${url.origin}`)), 10000);
        request.on('close', () => clearTimeout(deadline));
        request.on('error', reject);
    });
}

function handshake(address) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(address, 'binary', {origin, agent: agentFor(address), handshakeTimeout: 10000});
        let bytes = 0;
        let done = false;
        const finish = error => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            if (socket.readyState === WebSocket.OPEN) socket.close();
            else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
            if (error) reject(error); else resolve();
        };
        const timeout = setTimeout(() => finish(new Error('The server did not send its 8-byte login seed.')), 10000);
        socket.on('message', (data, binary) => {
            if (!binary) { finish(new Error('The server sent text instead of a binary game handshake.')); return; }
            bytes += data.length;
            if (bytes >= 8) finish(bytes === 8 ? undefined : new Error('The server handshake is incompatible with this client.'));
        });
        socket.on('error', finish);
        socket.on('close', () => { if (!done) finish(new Error('The server disconnected before the game handshake.')); });
    });
}

(async () => {
    console.log(`Checking world ${id} for browser origin ${origin}`);
    const list = JSON.parse((await download(directory)).toString('utf8'));
    if (!Array.isArray(list)) throw new Error('The world directory is not a JSON array.');
    const world = list.find(entry => entry?.id === id);
    if (!world) throw new Error(`World ${id} is not listed.`);
    const endpoints = worldAddresses(world.address, world.portOffset, origin.startsWith('https:'), world.websocketAddress);
    console.log('PASS: world directory and CORS');
    const crc = await download(`${endpoints.files}/crc`);
    if (crc.length !== 36) throw new Error(`Expected a 36-byte client CRC table; received ${crc.length} bytes.`);
    console.log('PASS: game file service and CORS');
    let connected = false;
    for (const endpoint of endpoints.sockets) {
        try {
            await handshake(endpoint);
            console.log(`PASS: WebSocket and 8-byte game handshake at ${endpoint}`);
            connected = true;
            break;
        } catch (error) { console.log(`FAIL: ${endpoint}: ${error.message}`); }
    }
    if (!connected) throw new Error('No advertised game endpoint completed the handshake.');
    console.log('Server transport checks passed. Account login, RSA-key compatibility, and gameplay still require an actual login from the deployed browser client. No credentials or login packet were sent.');
})().catch(error => { console.error(`Connection check failed: ${error.message}`); process.exitCode = 1; });
