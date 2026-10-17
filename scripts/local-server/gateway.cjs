const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {createPublicKey} = require('node:crypto');

function createGateway({client, server, backendPort = 8888, publicOrigin}) {
    const key = createPublicKey(fs.readFileSync(path.join(server, 'data/config/public.pem'))).export({format: 'jwk'});
    const decimal = value => BigInt('0x' + Buffer.from(value, 'base64url').toString('hex')).toString();
    const configuration = JSON.stringify({version: 1, revision: 225, modulus: decimal(key.n), exponent: decimal(key.e)});
    const types = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.png': 'image/png'};
    const gateway = http.createServer((req, res) => {
        let pathname, url;
        try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
        catch { res.writeHead(400).end(); return; }
        if (pathname === '/lorescape-local-server.zip') {
            res.writeHead(302, {Location: 'https://awest813.github.io/LoreScape/lorescape-local-server.zip'}).end();
            return;
        }
        if (pathname === '/') {
            const origin = publicOrigin || 'http://127.0.0.1:8080';
            res.writeHead(302, {Location: `/index.html?world=0&setup=1&local=${encodeURIComponent(origin)}`}).end();
            return;
        }
        if (pathname === '/index.html' && !url.searchParams.has('setup') && !url.searchParams.has('local')) {
            url.searchParams.set('setup', '1');
            url.searchParams.set('local', publicOrigin || 'http://127.0.0.1:8080');
            res.writeHead(302, {Location: url.pathname + url.search}).end();
            return;
        }
        if (pathname === '/lorescape-server.json') {
            res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}).end(configuration);
            return;
        }
        const filename = path.resolve(client, '.' + pathname);
        if (filename.startsWith(path.resolve(client) + path.sep) && fs.existsSync(filename) && fs.statSync(filename).isFile()) {
            if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
            res.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff'});
            if (req.method === 'HEAD') res.end();
            else fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
            return;
        }
        const upstream = http.request({hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers}, response => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
        });
        upstream.setTimeout(10000, () => upstream.destroy(new Error('Server timed out')));
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(503, {'Content-Type': 'text/plain'}); res.end('Game server is starting or unavailable. Check the server terminal and retry.'); });
        req.on('aborted', () => upstream.destroy());
        req.pipe(upstream);
    });
    gateway.on('upgrade', (req, socket, head) => {
        const upstream = http.request({hostname: '127.0.0.1', port: backendPort, path: req.url, headers: req.headers});
        upstream.setTimeout(10000, () => upstream.destroy());
        upstream.on('upgrade', (response, connection, upstreamHead) => {
            upstream.setTimeout(0);
            socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
            if (upstreamHead.length) socket.write(upstreamHead);
            if (head.length) connection.write(head);
            socket.on('error', () => connection.destroy());
            connection.on('error', () => socket.destroy());
            socket.on('close', () => connection.destroy());
            connection.on('close', () => socket.destroy());
            socket.pipe(connection).pipe(socket);
        });
        upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); });
        upstream.on('error', () => socket.destroy());
        socket.on('error', () => upstream.destroy());
        upstream.end();
    });
    return gateway;
}
module.exports = {createGateway};
