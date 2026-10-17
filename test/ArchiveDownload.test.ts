import {readFileSync} from 'node:fs';
import Packet from '../src/js/jagex2/io/Packet';
import {downloadArchive} from '../src/js/jagex2/io/ArchiveDownload';

const title: Int8Array = new Int8Array(readFileSync('test/resources/title'));
const crc: number = Packet.crc32(title);
afterEach((): void => {
    jest.restoreAllMocks();
});

test('downloads and verifies a real packed title archive', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(Uint8Array.from(title)));
    expect(await downloadArchive('/title', crc)).toEqual(title);
});

test('rejects an archive changed in transit and names its endpoint', async (): Promise<void> => {
    const corrupt: Int8Array = title.slice();
    corrupt[corrupt.length - 1] ^= 1;
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(Uint8Array.from(corrupt)));
    await expect(downloadArchive('/title', crc)).rejects.toThrow('Cannot load game archive /title. The game archive does not match');
});

test.each([Uint8Array.from(title.subarray(0, 5)), Uint8Array.from(title.subarray(0, title.length - 1)), new TextEncoder().encode('<html>Not game data</html>')])(
    'rejects truncated archives and HTML responses before caching or decoding them',
    async (bytes: Uint8Array): Promise<void> => {
        jest.spyOn(global, 'fetch').mockResolvedValue(new Response(bytes));
        await expect(downloadArchive('/title', crc)).rejects.toThrow('game archive');
    }
);
