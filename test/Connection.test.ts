import {socketUrl, validateSocketUrl, worldAddresses} from '../src/js/connection';

test('preserves advertised TLS on a local HTTP preview and supports current shared-port servers', (): void => {
    expect(worldAddresses('https://world.example:8443', 0, false)).toEqual({files: 'https://world.example:8443', host: 'https://world.example', sockets: ['wss://world.example:8443/', 'wss://world.example:43596/']});
});

test('uses the legacy port offset without mixing it with the file-server port', (): void => {
    expect(socketUrl({host: 'https://world.example:8443', port: 44594})).toBe('wss://world.example:44596/');
    expect(socketUrl({host: 'http://localhost', port: 43594})).toBe('ws://localhost:43595/');
});

test('supports an explicitly advertised proxy endpoint with its path', (): void => {
    expect(worldAddresses('https://files.example', 0, true, 'wss://game.example/play').sockets).toEqual(['wss://game.example/play']);
});

test('handles IPv6 addresses', (): void => {
    expect(socketUrl({host: 'https://[::1]:8443', port: 43594})).toBe('wss://[::1]:43596/');
});

test.each(['http://world.example', 'ws://world.example'])('blocks mixed-content connections on Pages: %s', (address: string): void => {
    expect((): string => socketUrl({host: address, port: 43594}, true)).toThrow('secure');
});

test.each([-1, 65535, 43594.5, NaN])('rejects invalid socket ports: %s', (port: number): void => {
    expect((): string => socketUrl({host: 'https://world.example', port})).toThrow('port');
});

test.each(['javascript:alert(1)', 'https://user:password@world.example'])('rejects incompatible or credential-bearing endpoints: %s', (address: string): void => {
    expect((): string => validateSocketUrl(address, true)).toThrow();
});
