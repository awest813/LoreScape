import {readFileSync} from 'node:fs';
import {downloadServerCache, resolveCacheSource} from '../src/js/cache-download';
import {createCacheZip} from '../src/js/cache-zip';
import Packet from '../src/js/jagex2/io/Packet';

const archive: Uint8Array = Uint8Array.from(readFileSync('test/resources/title'));
const checksum: number = Packet.crc32(new Int8Array(archive));
const names: string[] = ['title', 'config', 'interface', 'media', 'models', 'textures', 'wordenc', 'sounds'];
let crc: Uint8Array;
beforeEach((): void => {
    crc = new Uint8Array(36);
    const view: DataView = new DataView(crc.buffer);
    for (let index: number = 1; index <= 8; index++) view.setInt32(index * 4, checksum);
});
afterEach((): void => {
    jest.restoreAllMocks();
});

test('exports all verified archives and the original checksum table using live-server URLs', async (): Promise<void> => {
    const requested: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (url): Promise<Response> => {
        requested.push(String(url));
        return new Response(new Uint8Array(String(url).endsWith('/crc') ? crc : archive));
    });
    const progress: jest.Mock = jest.fn();
    const zip: Blob = await downloadServerCache({world: 1, address: 'https://server.example'}, new AbortController().signal, progress);
    expect(requested).toEqual(['https://server.example/crc', ...names.map((name: string): string => `https://server.example/${name}${checksum}`)]);
    expect(zip.type).toBe('application/zip');
    const bytes: Buffer = Buffer.from(await zip.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(bytes.length - 12)).toBe(10);
    expect(bytes.includes(Buffer.from('README.txt'))).toBe(true);
    expect(bytes.includes(Buffer.from('does not enable offline play'))).toBe(true);
    expect(progress).toHaveBeenCalledWith('Downloading 8 of 8: sounds…');
});

test('browser bundle exports request unpacked archive names', async (): Promise<void> => {
    const requested: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (url): Promise<Response> => {
        requested.push(String(url));
        return new Response(new Uint8Array(String(url).endsWith('/crc') ? crc : archive));
    });
    await downloadServerCache({world: 998, address: 'data/pack/client'}, new AbortController().signal, (): void => {});
    expect(requested).toEqual(['data/pack/client/crc', ...names.map((name: string): string => `data/pack/client/${name}`)]);
});

test('bad archive contents fail before a ZIP can be saved', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(crc)).mockResolvedValueOnce(new Response('Not a game archive'));
    await expect(downloadServerCache({world: 0, address: 'http://localhost:8888'}, new AbortController().signal, (): void => {})).rejects.toThrow('Cannot load game archive');
});

test('cancelling between files prevents further network requests', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    const fetcher: jest.SpyInstance = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(crc));
    await expect(
        downloadServerCache({world: 1, address: 'https://server.example'}, controller.signal, (message: string): void => {
            if (message.startsWith('Downloading')) controller.abort();
        })
    ).rejects.toThrow();
    // Fetch receives an already-aborted signal if cancellation occurs in the progress callback.
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
});

test('local source respects the chosen web port and secure-page restrictions', async (): Promise<void> => {
    expect(await resolveCacheSource(0, 'http://localhost:8888', false, new AbortController().signal)).toEqual({world: 0, address: 'http://localhost:8888'});
    await expect(resolveCacheSource(0, 'http://localhost:8888', true, new AbortController().signal)).rejects.toThrow('HTTPS launcher');
    expect(await resolveCacheSource(999, '', true, new AbortController().signal)).toEqual({world: 999, address: 'data/pack/client'});
});

test.each(['../file', '/absolute', 'folder/../file', 'folder\\file'])('ZIP rejects unsafe paths: %s', (name: string): void => {
    expect((): Blob => createCacheZip([{name, bytes: new Uint8Array([1])}])).toThrow('filename');
});

test('ZIP rejects duplicate entries', (): void => {
    expect(
        (): Blob =>
            createCacheZip([
                {name: 'crc', bytes: crc},
                {name: 'crc', bytes: crc}
            ])
    ).toThrow('filename');
});
