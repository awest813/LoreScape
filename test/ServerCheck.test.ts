import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {createServer, Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocketServer} from 'ws';

const origin: string = 'http://127.0.0.1:4173';
let http: Server;
let sockets: WebSocketServer;
let mode: string = 'valid';
let loginPackets: number = 0;
let port: number;

beforeEach(async (): Promise<void> => {
    mode = 'valid';
    loginPackets = 0;
    http = createServer((request, response): void => {
        if (mode !== 'cors') response.setHeader('Access-Control-Allow-Origin', origin);
        if (request.url === '/worlds') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify([{id: 1, region: 'Fixture', address: `http://127.0.0.1:${port}`, portOffset: 0, players: 0, websocketAddress: `ws://127.0.0.1:${port}/`}]));
        } else if (request.url === '/crc') response.end(Buffer.alloc(mode === 'crc' ? 37 : 36));
        else {
            response.writeHead(404);
            response.end();
        }
    });
    sockets = new WebSocketServer({server: http, verifyClient: (info: {origin: string}): boolean => info.origin === origin});
    sockets.on('connection', (socket): void => {
        socket.on('message', (): void => {
            loginPackets++;
        });
        socket.send(mode === 'seed' ? 'not a binary game server' : new Uint8Array(8));
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    port = (http.address() as AddressInfo).port;
});

afterEach(async (): Promise<void> => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve): void => {
        sockets.close((): void => resolve());
    });
    await new Promise<void>((resolve): void => {
        http.close((): void => resolve());
    });
});

async function check(local: boolean = false): Promise<string> {
    return new Promise<string>((resolve, reject): void => {
        execFile(
            process.execPath,
            ['--experimental-strip-types', 'scripts/check-server.cjs', ...(local ? ['--local', `http://127.0.0.1:${port}`] : ['--world', '1', '--directory', `http://127.0.0.1:${port}/worlds`]), '--origin', origin],
            {
                cwd: process.cwd(),
                env: {...process.env, NO_PROXY: 'localhost,127.0.0.1'},
                timeout: 5000
            },
            (error, stdout): void => {
                if (error) reject(error);
                else resolve(stdout);
            }
        );
    });
}

test('verifies real CORS, file checksums, and the WebSocket handshake without submitting a login', async (): Promise<void> => {
    expect(await check()).toContain('Server transport checks passed');
    expect(loginPackets).toBe(0);
});

test.each(['cors', 'crc', 'seed'])('does not report a broken %s service as reachable', async (failure: string): Promise<void> => {
    mode = failure;
    await expect(check()).rejects.toThrow();
});

test('local server check uses its explicit web address without a public directory', async (): Promise<void> => {
    const output: string = await check(true);
    expect(output).toContain('Checking world 0');
    expect(output).toContain('Server transport checks passed');
    expect(output).not.toContain('world directory and CORS');
    expect(loginPackets).toBe(0);
});
