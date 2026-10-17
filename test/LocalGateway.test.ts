import {createServer, Server} from 'node:http';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {AddressInfo} from 'node:net';
import {WebSocket, WebSocketServer} from 'ws';
import {createGateway} from '../scripts/local-server/gateway.cjs';
import {parseSetupKey} from '../src/js/setup-key';

let root: string;
let backend: Server;
let gateway: Server;
let sockets: WebSocketServer;
let address: string;
async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve): void => {
        server.listen(0, '127.0.0.1', resolve);
    });
    return (server.address() as AddressInfo).port;
}
beforeAll(async (): Promise<void> => {
    root = mkdtempSync(join(tmpdir(), 'lorescape-kit-'));
    mkdirSync(join(root, 'client'));
    mkdirSync(join(root, 'data/config'), {recursive: true});
    mkdirSync(join(root, 'data/pack/mapview'), {recursive: true});
    mkdirSync(join(root, 'data/pack/server'), {recursive: true});
    mkdirSync(join(root, 'data/src/pack'), {recursive: true});
    writeFileSync(join(root, 'data/pack/mapview/worldmap.jag'), 'map archive');
    writeFileSync(join(root, 'data/pack/server/mesanim.dat'), 'chat animations');
    writeFileSync(join(root, 'data/src/pack/npc.pack'), '0=test_npc');
    writeFileSync(join(root, 'data/src/pack/obj.pack'), '0=test_item');
    writeFileSync(join(root, 'data/src/pack/synth.pack'), '0=test_sound');
    const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 1024, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs1', format: 'pem'}});
    writeFileSync(join(root, 'data/config/public.pem'), publicKey);
    writeFileSync(join(root, 'client/index.html'), '<!doctype html><title>kit</title>');
    writeFileSync(join(root, 'client/icon.svg'), '<svg/>');
    backend = createServer((req, res): void => {
        if (req.url === '/crc') res.writeHead(200).end(Buffer.alloc(36, 5));
        else res.writeHead(404).end();
    });
    sockets = new WebSocketServer({server: backend});
    sockets.on('connection', (socket: WebSocket): void => {
        socket.send(Buffer.alloc(8, 7));
        socket.on('message', (data): void => {
            socket.send(data);
        });
    });
    const backendPort: number = await listen(backend);
    gateway = createGateway({client: join(root, 'client'), server: root, backendPort, publicOrigin: 'https://play.example.com'});
    address = `http://127.0.0.1:${await listen(gateway)}`;
});

test.each(['playground', 'items', 'sounds', 'interface-editor', 'mapview', 'mesanim'])('connects the downloaded %s tool to the local server by default', async (tool: string): Promise<void> => {
    const response: Response = await fetch(`${address}/${tool}.html`, {redirect: 'manual'});
    const url: URL = new URL(response.headers.get('location')!, address);
    expect(response.status).toBe(302);
    expect(url.searchParams.get('world')).toBe('0');
    expect(url.searchParams.get('setup')).toBe('1');
    expect(url.searchParams.get('local')).toBe('https://play.example.com');
    const explicit: Response = await fetch(`${address}/${tool}.html?world=2`, {redirect: 'manual'});
    expect(explicit.headers.has('location')).toBe(false);
});

test('serves only the extra data files required by the local tools', async (): Promise<void> => {
    expect(await (await fetch(`${address}/worldmap.jag`)).text()).toBe('map archive');
    expect(await (await fetch(`${address}/server/mesanim.dat`)).text()).toBe('chat animations');
    expect(await (await fetch(`${address}/tool-data/npc.pack`)).text()).toBe('0=test_npc');
    expect(await (await fetch(`${address}/tool-data/obj.pack`)).text()).toBe('0=test_item');
    expect(await (await fetch(`${address}/tool-data/sound.pack`)).text()).toBe('0=test_sound');
    expect((await fetch(`${address}/server/script.dat`)).status).toBe(404);
    expect((await fetch(`${address}/tool-data/../data/config/private.pem`)).status).toBe(404);
});
afterAll(async (): Promise<void> => {
    for (const socket of sockets.clients) socket.terminate();
    await Promise.all([
        new Promise<void>((resolve): void => {
            gateway.close((): void => resolve());
        }),
        new Promise<void>((resolve): void => {
            sockets.close((): void => {
                backend.close((): void => resolve());
            });
        })
    ]);
    rmSync(root, {recursive: true, force: true});
});

test('redirects the hosted root to its own launcher with explicit setup key selection', async (): Promise<void> => {
    const response: Response = await fetch(address, {redirect: 'manual'});
    const url: URL = new URL(response.headers.get('location')!, address);
    expect(response.status).toBe(302);
    expect(url.searchParams.get('setup')).toBe('1');
    expect(url.searchParams.get('local')).toBe('https://play.example.com');
    const download: Response = await fetch(`${address}/lorescape-local-server.zip`, {redirect: 'manual'});
    expect(download.headers.get('location')).toBe('https://awest813.github.io/LoreScape/lorescape-local-server.zip');
    const back: Response = await fetch(`${address}/index.html`, {redirect: 'manual'});
    const backUrl: URL = new URL(back.headers.get('location')!, address);
    expect(backUrl.searchParams.get('setup')).toBe('1');
    expect(backUrl.searchParams.has('world')).toBe(false);
});

test('serves client assets with MIME types and proxies game files through the same origin', async (): Promise<void> => {
    expect((await fetch(`${address}/icon.svg`)).headers.get('content-type')).toBe('image/svg+xml');
    expect(await (await fetch(`${address}/index.html`)).text()).toContain('<title>kit</title>');
    const crc: Uint8Array = new Uint8Array(await (await fetch(`${address}/crc`)).arrayBuffer());
    expect(Array.from(crc)).toEqual(Array(36).fill(5));
    const configuration: unknown = await (await fetch(`${address}/lorescape-server.json`)).json();
    expect(parseSetupKey(configuration)).toBeGreaterThan(2n ** 511n);
    expect((await fetch(`${address}/data/config/public.pem`)).status).toBe(404);
});

test('forwards the real WebSocket login seed and bidirectional binary frames', async (): Promise<void> => {
    await new Promise<void>((resolve, reject): void => {
        const socket: WebSocket = new WebSocket(address.replace('http:', 'ws:'));
        let seed: boolean = false;
        socket.on('error', reject);
        socket.on('message', (data, binary): void => {
            try {
                expect(binary).toBe(true);
                if (!seed) {
                    expect(Buffer.from(data as Buffer)).toEqual(Buffer.alloc(8, 7));
                    seed = true;
                    socket.send(Buffer.from([16, 1, 2, 3]));
                } else {
                    expect(Buffer.from(data as Buffer)).toEqual(Buffer.from([16, 1, 2, 3]));
                    socket.close();
                }
            } catch (error) {
                socket.terminate();
                reject(error);
            }
        });
        socket.on('close', (): void => resolve());
    });
});
