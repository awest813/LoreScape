import {localWorldAddresses} from '../src/js/connection';
import {checkWorkerBundle, loadClientChecksums, usesRoomLobby} from '../src/js/local-worlds';

afterEach((): void => {
    jest.restoreAllMocks();
});

test('local server uses its web port before the legacy game port', (): void => {
    expect(localWorldAddresses('http://localhost:8888', false)).toEqual({files: 'http://localhost:8888', host: 'http://localhost', sockets: ['ws://localhost:8888/', 'ws://localhost:43595/']});
    expect(localWorldAddresses('http://localhost', false).files).toBe('http://localhost');
    expect(localWorldAddresses('http://[::1]:8888', false).sockets[0]).toBe('ws://[::1]:8888/');
});

test('HTTPS launcher gives actionable guidance for an HTTP local server', (): void => {
    expect((): object => localWorldAddresses('http://localhost:8888', true)).toThrow('npm run dev');
    expect(localWorldAddresses('https://server.example:8443', true).sockets).toEqual(['wss://server.example:8443/', 'wss://server.example:43596/']);
});

test.each(['localhost:8888', 'ws://localhost', 'http://user:secret@localhost', 'http://localhost/client', 'http://localhost/?key=secret', 'http://localhost/#x'])('rejects ambiguous or unsafe server origin %s', (address: string): void => {
    expect((): object => localWorldAddresses(address, false)).toThrow();
});

test('rejects an HTML fallback before decoding it as game checksums', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('<html>Not a game server</html>'));
    await expect(loadClientChecksums('http://localhost:8888', 0)).rejects.toThrow('not an HTML page');
});

test('file failures name the resource and the local setup remedy', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('missing', {status: 404}));
    await expect(loadClientChecksums('data/pack/client', 998)).rejects.toThrow('data/pack/client/crc');
    await expect(loadClientChecksums('data/pack/client', 999)).rejects.toThrow('Install the matching client game data');
});

test('valid CRC bytes survive without signed-byte corruption', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(36).fill(255)));
    expect(await loadClientChecksums('/files', 0)).toEqual(new Int8Array(36).fill(-1));
});

test.each([404, 200])('missing worker or HTML fallback returns setup instructions (%s)', async (status: number): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('<html/>', {status, headers: {'Content-Type': 'text/html'}}));
    await expect(checkWorkerBundle()).rejects.toThrow('not included in the GitHub Pages build');
});

test('accepts a served JavaScript worker module', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('/* module */', {headers: {'Content-Type': 'application/javascript'}}));
    await expect(checkWorkerBundle()).resolves.toBeUndefined();
});

test.each([
    [{version: 1, kind: 'lorescape-coop'}, true],
    [{version: 2, kind: 'lorescape-coop'}, false],
    [{version: 1, kind: 'other'}, false],
    [null, false]
])('recognizes only compatible room-lobby bundles: %s', async (metadata: unknown, expected: boolean): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(metadata)));
    await expect(usesRoomLobby(new AbortController().signal)).resolves.toBe(expected);
});

test('missing room metadata preserves support for external clipboard bundles', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('missing', {status: 404}));
    await expect(usesRoomLobby(new AbortController().signal)).resolves.toBe(false);
});

test('room metadata checks propagate cancellation', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    controller.abort();
    jest.spyOn(global, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(usesRoomLobby(controller.signal)).rejects.toThrow('Aborted');
});
