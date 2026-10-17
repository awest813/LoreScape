import {importCacheFiles} from '../src/js/cache-import';
jest.mock('../src/js/page-shell', (): object => ({setPageStatus: jest.fn()}));

test('imports supported file names with their original binary contents and ignores unrelated files', async (): Promise<void> => {
    const cachesave: jest.Mock = jest.fn().mockResolvedValue(true);
    const count: number = await importCacheFiles([new File([new Uint8Array([0, 128, 255])], 'main_file_cache.dat'), new File(['index'], 'main_file_cache.idx0'), new File(['other'], 'notes.txt')], {cachesave});
    expect(count).toBe(2);
    expect(cachesave).toHaveBeenCalledWith('main_file_cache.dat', new Int8Array([0, -128, -1]));
    expect(cachesave).toHaveBeenCalledTimes(2);
});

test('unsupported files receive a useful message instead of a false success', async (): Promise<void> => {
    const cachesave: jest.Mock = jest.fn();
    await expect(importCacheFiles([new File(['x'], 'notes.txt')], {cachesave})).rejects.toThrow('Choose main_file_cache.dat');
    expect(cachesave).not.toHaveBeenCalled();
});

test('storage failure stops importing further files and reports the remedy', async (): Promise<void> => {
    const cachesave: jest.Mock = jest.fn().mockResolvedValue(false);
    await expect(importCacheFiles([new File(['x'], 'main_file_cache.dat'), new File(['y'], 'main_file_cache.idx0')], {cachesave})).rejects.toThrow('Enable site storage');
    expect(cachesave).toHaveBeenCalledTimes(1);
});

test('file read errors propagate for the import UI to handle', async (): Promise<void> => {
    const file: File = {
        name: 'main_file_cache.dat',
        arrayBuffer: async (): Promise<ArrayBuffer> => {
            throw new Error('File permission denied');
        }
    } as File;
    const cachesave: jest.Mock = jest.fn();
    await expect(importCacheFiles([file], {cachesave})).rejects.toThrow('File permission denied');
    expect(cachesave).not.toHaveBeenCalled();
});
