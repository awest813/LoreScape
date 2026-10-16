const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../public');
const port = Number(process.env.PORT || 4173);
const base = process.env.BASE_PATH || '/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('BASE_PATH must begin and end with /.');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.sf2': 'application/octet-stream'};
http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (base !== '/' && pathname === base.slice(0, -1)) { response.writeHead(301, {Location: base}).end(); return; }
    if (!pathname.startsWith(base)) { response.writeHead(404).end('Not found'); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || relative.split('/').some(part => part.startsWith('.'))) { response.writeHead(404).end('Not found'); return; }
    fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
        if (request.method === 'HEAD') response.end();
        else fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
    });
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://localhost:${port}${base}`));
