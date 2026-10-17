import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {createWebServer} from '../web-server.mjs';

test('hosting serves launcher aliases and game queries, preserves MIME and HEAD, rejects escapes', async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'lorescape-host-'));
    const directory = path.join(base, 'web');
    const {mkdirSync} = await import('node:fs');
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'coop.html'), 'launcher');
    writeFileSync(path.join(directory, 'index.html'), 'game');
    writeFileSync(path.join(directory, 'test.wasm'), new Uint8Array([0, 97, 115, 109]));
    writeFileSync(path.join(base, 'private.txt'), 'private');
    symlinkSync(path.join(base, 'private.txt'), path.join(directory, 'escape.txt'));
    const server = createWebServer(directory);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const route of ['/coop', '/coop/', '/coop.html']) {
            const response = await fetch(origin + route);
            assert.equal(response.status, 200);
            assert.equal(await response.text(), 'launcher');
        }
        const root = await fetch(origin, {redirect: 'manual'});
        assert.equal(root.status, 302);
        assert.equal(root.headers.get('location'), '/coop.html');
        assert.equal(await (await fetch(origin + '/?world=999')).text(), 'game');
        const wasm = await fetch(origin + '/test.wasm', {method: 'HEAD'});
        assert.equal(wasm.headers.get('content-type'), 'application/wasm');
        assert.equal(wasm.headers.get('content-length'), '4');
        assert.equal(wasm.headers.get('cache-control'), 'no-store');
        assert.equal((await wasm.arrayBuffer()).byteLength, 0);
        assert.equal((await fetch(origin + '/missing')).status, 404);
        assert.equal((await fetch(origin + '/escape.txt')).status, 403);
        assert.equal((await fetch(origin + '/coop', {method: 'POST'})).status, 405);
        assert.deepEqual(await (await fetch(origin + '/healthz')).json(), {status: 'ok'});
        const status = await new Promise((resolve, reject) => {
            http.get(origin + '/%2e%2e%2fprivate.txt', response => {response.resume(); resolve(response.statusCode);}).on('error', reject);
        });
        assert.equal(status, 403);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        rmSync(base, {recursive: true, force: true});
    }
});
