import {once} from 'node:events';
import {createServer, Server} from 'node:http';
import type {AddressInfo, Socket as NetSocket} from 'node:net';
import {WebSocketServer, WebSocket as ServerSocket} from 'ws';
import ClientStream from '../src/js/jagex2/io/ClientStream';

let server: WebSocketServer | undefined;
let stream: ClientStream | undefined;

afterEach(async (): Promise<void> => {
    stream?.close();
    stream = undefined;
    if (server) {
        for (const client of server.clients) client.terminate();
        await new Promise<void>((resolve): void => {
            server!.close((): void => resolve());
        });
        server = undefined;
    }
});

async function serve(connected: (socket: ServerSocket) => void): Promise<number> {
    server = new WebSocketServer({host: '127.0.0.1', port: 0});
    server.on('connection', connected);
    await once(server, 'listening');
    return (server.address() as AddressInfo).port;
}

async function connect(port: number): Promise<ClientStream> {
    stream = new ClientStream(await ClientStream.openSocket({host: 'http://127.0.0.1', port: port - 1}));
    return stream;
}

test('receives the real binary seed handshake, sends a login packet, and reads a rejection reply', async (): Promise<void> => {
    const port: number = await serve((socket: ServerSocket): void => {
        expect(socket.protocol).toBe('binary');
        socket.send(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 2]));
        socket.once('message', (packet): void => {
            expect(new Uint8Array(packet as Buffer)[0]).toBe(16);
            socket.send(new Uint8Array([3]));
        });
    });
    const client: ClientStream = await connect(port);
    const seed: Uint8Array = new Uint8Array(8);
    await client.readBytes(seed, 0, 8, 1000);
    expect([...seed]).toEqual([0, 0, 0, 1, 0, 0, 0, 2]);
    client.write(new Uint8Array([16, 1, 225]), 3);
    expect(await client.read(1000)).toBe(3);
});

test('reads bytes split across WebSocket frames without losing or reordering data', async (): Promise<void> => {
    const port: number = await serve((socket: ServerSocket): void => {
        socket.send(new Uint8Array([1, 2]));
        setTimeout((): void => {
            if (socket.readyState === ServerSocket.OPEN) socket.send(new Uint8Array([3, 4, 5]));
        }, 10);
    });
    const client: ClientStream = await connect(port);
    const bytes: Uint8Array = new Uint8Array(5);
    await client.readBytes(bytes, 0, 5, 1000);
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
});

test('tries the next advertised endpoint if the first WebSocket path is rejected', async (): Promise<void> => {
    const port: number = await serve((socket: ServerSocket): void => {
        socket.send(new Uint8Array([7]));
    });
    server!.options.path = '/game';
    const socket: WebSocket = await ClientStream.openSocket({host: 'http://127.0.0.1', port: port - 1, urls: [`ws://127.0.0.1:${port}/missing`, `ws://127.0.0.1:${port}/game`]}, 100);
    stream = new ClientStream(socket);
    expect(await stream.read(1000)).toBe(7);
});

test('rejects a stalled server handshake and closes the connection', async (): Promise<void> => {
    const port: number = await serve((): void => {});
    const client: ClientStream = await connect(port);
    await expect(client.readBytes(new Uint8Array(8), 0, 8, 20)).rejects.toThrow('Timed out');
    expect(client.available).toBe(0);
    await expect(client.read()).rejects.toThrow('closed');
});

test('rejects a server that disconnects during the handshake immediately', async (): Promise<void> => {
    const port: number = await serve((socket: ServerSocket): void => {
        setTimeout((): void => socket.close(), 10);
    });
    const client: ClientStream = await connect(port);
    await expect(client.readBytes(new Uint8Array(8), 0, 8, 1000)).rejects.toThrow('closed');
});

test('times out an HTTP endpoint that never upgrades to WebSocket', async (): Promise<void> => {
    const sockets: Set<NetSocket> = new Set();
    const http: Server = createServer();
    http.on('connection', (socket: NetSocket): void => {
        sockets.add(socket);
    });
    http.on('upgrade', (): void => {});
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    try {
        const port: number = (http.address() as AddressInfo).port;
        await expect(ClientStream.openSocket({host: 'http://127.0.0.1', port: port - 1}, 20)).rejects.toThrow('timed out');
    } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve): void => {
            http.close((): void => resolve());
        });
    }
});
