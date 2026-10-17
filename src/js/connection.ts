export const WORLD_LIST_URL: string = 'https://2004scape.org/api/v1/worldlist';

export type SocketAddress = {host: string; port: number; urls?: string[]};

export function validateSocketUrl(address: string, securePage: boolean): string {
    const url: URL = new URL(address);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid WebSocket endpoint.');
    if (securePage && url.protocol !== 'wss:') throw new Error('This page requires a secure game server connection (WSS).');
    return url.href;
}

export function socketUrl(socket: SocketAddress, securePage: boolean = false): string {
    const url: URL = new URL(socket.host);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid game server address.');
    const secure: boolean = url.protocol === 'https:' || url.protocol === 'wss:';
    if (securePage && !secure) throw new Error('This page requires a secure game server connection (WSS).');
    const port: number = socket.port + (secure ? 2 : 1);
    if (!Number.isInteger(socket.port) || socket.port < 1 || port < 1 || port > 65535) throw new Error('Invalid game server port.');
    url.protocol = secure ? 'wss:' : 'ws:';
    url.port = String(port);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.href;
}

export function worldAddresses(address: string, portOffset: number, securePage: boolean, websocketAddress?: string): {files: string; host: string; sockets: string[]} {
    const url: URL = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid world address.');
    const host: string = `${url.protocol}//${url.hostname}`;
    // Validate both endpoints before starting downloads or attempting a login.
    const legacy: string = socketUrl({host, port: 43594 + portOffset}, securePage);
    const shared: URL = new URL(url.origin);
    shared.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const sockets: string[] = websocketAddress ? [validateSocketUrl(websocketAddress, securePage)] : [...new Set([shared.href, legacy])];
    return {files: url.origin, host, sockets};
}

export const DEFAULT_LOCAL_ADDRESS: string = 'http://localhost:8888';

export function localWorldAddresses(address: string, securePage: boolean): {files: string; host: string; sockets: string[]} {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        throw new Error('Enter a complete local server URL, for example http://localhost:8888.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Use the server HTTP or HTTPS origin with its port, without a path, password, or query.');
    }
    if (securePage && url.protocol !== 'https:') {
        throw new Error('This HTTPS launcher requires an HTTPS/WSS server. For an HTTP local server, run npm run dev and open http://localhost:8080/.');
    }
    return worldAddresses(url.origin, 0, securePage);
}
