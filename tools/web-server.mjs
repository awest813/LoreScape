import http from 'node:http';
import {createReadStream, realpathSync, statSync} from 'node:fs';
import path from 'node:path';

const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};
export function createWebServer(directory) {
    const base = realpathSync(directory);
    return http.createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, {Allow: 'GET, HEAD'}).end(); return; }
        try {
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname === '/healthz') { response.writeHead(200, {'Content-Type': 'application/json'}).end(request.method === 'HEAD' ? undefined : '{"status":"ok"}'); return; }
            if (url.pathname === '/' && !url.searchParams.has('world')) { response.writeHead(302, {Location: '/coop.html'}).end(); return; }
            const route = ['/coop', '/coop/'].includes(url.pathname) ? '/coop.html' : url.pathname === '/' ? '/index.html' : url.pathname;
            const decoded = decodeURIComponent(route);
            if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..')) { response.writeHead(403).end(); return; }
            const filename = path.resolve(base, '.' + decoded);
            if (!filename.startsWith(base + path.sep)) { response.writeHead(403).end(); return; }
            const resolved = realpathSync(filename);
            if (!resolved.startsWith(base + path.sep)) { response.writeHead(403).end(); return; }
            const info = statSync(resolved);
            if (!info.isFile()) { response.writeHead(404).end(); return; }
            response.writeHead(200, {'Content-Type': mime[path.extname(resolved)] || 'application/octet-stream', 'Content-Length': info.size});
            if (request.method === 'HEAD') { response.end(); return; }
            const stream = createReadStream(resolved);
            stream.on('error', () => response.destroy());
            stream.pipe(response);
        } catch (error) {
            response.writeHead(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 400).end();
        }
    });
}
