import {readFileSync} from 'node:fs';
import {readCacheZip, readCacheFolder, cacheNames} from '../src/js/cache-bundle';
import {createCacheZip} from '../src/js/cache-zip';
import {importCacheSelection} from '../src/js/cache-import';
jest.mock('../src/js/page-shell', (): object => ({setPageStatus: jest.fn()}));
const fixture: Uint8Array = Uint8Array.from(readFileSync('test/resources/classic-import-deflated.zip'));

async function bundle(): Promise<import('../src/js/cache-bundle').CacheFile[]> {
    return readCacheZip(new File([new Uint8Array(fixture).buffer], 'cache.zip'));
}

test('reads a standard compressed ZIP with a nested cache directory and empty index files', async (): Promise<void> => {
    const files: import('../src/js/cache-bundle').CacheFile[] = await bundle();
    expect(files.map((file): string => file.name)).toEqual(cacheNames);
    expect(files[0].bytes.length).toBe(1560);
    expect(files[5].bytes.length).toBe(0);
});

test('the downloaded ZIP format imports as a complete cache without extracting it first', async (): Promise<void> => {
    const zip: Blob = createCacheZip(await bundle());
    const cachesaveMany: jest.Mock = jest.fn().mockResolvedValue(true);
    const cachesave: jest.Mock = jest.fn();
    const count: number = await importCacheSelection([new File([zip], 'download.zip')], {cachesave, cachesaveMany});
    expect(count).toBe(6);
    expect(cachesaveMany).toHaveBeenCalledTimes(1);
    expect(cachesave).not.toHaveBeenCalled();
});

test('folder selection finds all six files and ignores unrelated files', async (): Promise<void> => {
    const files: File[] = (await bundle()).map((entry): File => {
        const file: File = new File([new Uint8Array(entry.bytes).buffer], entry.name);
        Object.defineProperty(file, 'webkitRelativePath', {value: `my-cache/nested/${entry.name}`});
        return file;
    });
    files.push(new File(['notes'], 'README.txt'));
    expect((await readCacheFolder(files)).map((file): string => file.name)).toEqual(cacheNames);
});

test('incomplete ZIPs never write over the saved cache', async (): Promise<void> => {
    const zip: Blob = createCacheZip((await bundle()).slice(0, 5));
    const cachesave: jest.Mock = jest.fn();
    await expect(importCacheSelection([new File([zip], 'incomplete.zip')], {cachesave})).rejects.toThrow('Missing');
    expect(cachesave).not.toHaveBeenCalled();
});

test('stored ZIP payload corruption is rejected before cache writes', async (): Promise<void> => {
    const bytes: Uint8Array = new Uint8Array(await createCacheZip(await bundle()).arrayBuffer());
    bytes[30 + new TextEncoder().encode(cacheNames[0]).length + 100] ^= 1;
    await expect(readCacheZip(new File([bytes], 'bad.zip'))).rejects.toThrow('checksum');
});

test('multiple cache sets inside a ZIP are rejected instead of mixed together', async (): Promise<void> => {
    const files: import('../src/js/cache-bundle').CacheFile[] = await bundle();
    const zip: Blob = createCacheZip([
        ...files.map((file): import('../src/js/cache-bundle').CacheFile => ({...file, name: 'one/' + file.name})),
        ...files.map((file): import('../src/js/cache-bundle').CacheFile => ({...file, name: 'two/' + file.name}))
    ]);
    await expect(readCacheZip(new File([zip], 'multiple.zip'))).rejects.toThrow('folder');
});

test('cache data and index mismatches are rejected', async (): Promise<void> => {
    const files: import('../src/js/cache-bundle').CacheFile[] = await bundle();
    files[1].bytes[41] = 30;
    await expect(readCacheZip(new File([createCacheZip(files)], 'mismatched.zip'))).rejects.toThrow('do not match');
});

test('truncated and browser-pack ZIPs give actionable errors', async (): Promise<void> => {
    await expect(readCacheZip(new File([fixture.slice(0, 20)], 'truncated.zip'))).rejects.toThrow('complete ZIP');
    await expect(readCacheZip(new File([createCacheZip([{name: 'data/pack/client/crc', bytes: new Uint8Array(36)}])], 'core.zip'))).rejects.toThrow('Classic cache');
});

test('oversized ZIP metadata is rejected before allocating unpacked file buffers', async (): Promise<void> => {
    const bytes: Uint8Array = new Uint8Array(await createCacheZip(await bundle()).arrayBuffer());
    const view: DataView = new DataView(bytes.buffer);
    const directory: number = view.getUint32(bytes.length - 6, true);
    view.setUint32(directory + 24, 128 * 1024 * 1024 + 1, true);
    await expect(readCacheZip(new File([bytes], 'oversized.zip'))).rejects.toThrow('128 MB');
});
