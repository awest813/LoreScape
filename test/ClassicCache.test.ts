import {readFileSync} from 'node:fs';
import {gunzipSync, gzipSync} from 'node:zlib';
import {buildToolsCache} from '../src/js/tools-cache-export';
import {ClassicCacheWriter} from '../src/js/classic-cache';
import {encodeModel317} from '../src/js/model-export';
import Model from '../src/js/jagex2/graphics/Model';
import Jagfile from '../src/js/jagex2/io/Jagfile';
import DiskStore from '../src/js/jagex2/io/DiskStore';
import Bzip from '../src/js/vendor/bzip';
import type {ZipFile} from '../src/js/cache-zip';
jest.mock('../src/js/vendor/gzip', (): object => ({decompress: (bytes: Uint8Array): Uint8Array => new Uint8Array(gunzipSync(bytes))}));

beforeAll(async (): Promise<void> => {
    await Bzip.load(readFileSync('test/resources/bz2.wasm'));
});

test('classic sectors round-trip through the tools DiskStore reader, including multi-sector files', (): void => {
    const writer: ClassicCacheWriter = new ClassicCacheWriter();
    const title: Uint8Array = Uint8Array.from(readFileSync('test/resources/title'));
    const model: Uint8Array = Uint8Array.from({length: 2500}, (_value: unknown, i: number): number => i % 256);
    writer.add(0, 1, title);
    writer.add(1, 17, new Uint8Array(gzipSync(model)));
    const files: ZipFile[] = writer.files();
    expect(files.map((file: ZipFile): string => file.name)).toEqual(['main_file_cache.dat', ...[0, 1, 2, 3, 4].map((id: number): string => `main_file_cache.idx${id}`)]);
    const jag: DiskStore = new DiskStore(files[0].bytes, files[1].bytes, 0);
    expect(jag.read(1, true)).toEqual(title);
    const models: DiskStore = new DiskStore(files[0].bytes, files[2].bytes, 1);
    expect(models.read(17)).toEqual(model);
    expect(models.read(0)).toBeNull();
    expect(files.slice(3).every((file: ZipFile): boolean => file.bytes.length === 0)).toBe(true);
});

test('every fixture model preserves geometry, textures, colors and labels in the tools classic decoder', (): void => {
    Model.unpack(new Jagfile(Uint8Array.from(readFileSync('test/resources/models'))));
    const ids: number[] = Model.metadata!.flatMap((entry: unknown, id: number): number[] => (entry ? [id] : []));
    expect(ids.length).toBeGreaterThan(100);
    const fields: Array<keyof Model> = [
        'vertexX',
        'vertexY',
        'vertexZ',
        'faceVertexA',
        'faceVertexB',
        'faceVertexC',
        'faceInfo',
        'facePriority',
        'faceAlpha',
        'faceColor',
        'vertexLabel',
        'faceLabel',
        'texturedVertexA',
        'texturedVertexB',
        'texturedVertexC'
    ];
    for (const id of ids) {
        const original: Model = Model.model(id);
        const meta: NonNullable<typeof Model.metadata>[number] = Model.metadata![id];
        const encoded: Uint8Array = encodeModel317(original);
        Model.unpack317(encoded, id);
        const decoded: Model = Model.model317(encoded, id);
        for (const field of fields) {
            const expected: Int32Array | null = original[field] as Int32Array | null;
            const actual: Int32Array | null = decoded[field] as Int32Array | null;
            if (expected === null || actual === null) {
                if (expected !== actual) throw new Error(`Model ${id}: ${String(field)} null mismatch`);
            } else if (!Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength).equals(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength))) throw new Error(`Model ${id}: ${String(field)} mismatch`);
        }
        expect(decoded.priority).toBe(original.priority);
        Model.metadata![id] = meta;
    }
});

test('invalid classic entries fail rather than overwrite cache sectors', (): void => {
    const writer: ClassicCacheWriter = new ClassicCacheWriter();
    expect((): void => writer.add(5, 1, new Uint8Array([1]))).toThrow('Invalid');
    writer.add(0, 1, new Uint8Array([1]));
    expect((): void => writer.add(0, 1, new Uint8Array([2]))).toThrow('Invalid');
});

test('classic conversion refuses missing archive sets', async (): Promise<void> => {
    await expect(buildToolsCache([], new AbortController().signal, (): void => {})).rejects.toThrow('eight');
});

test('cancelled conversion stops before parsing models or writing cache data', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    controller.abort();
    await expect(
        buildToolsCache(
            Array.from({length: 8}, (): Uint8Array => new Uint8Array([1])),
            controller.signal,
            (): void => {}
        )
    ).rejects.toMatchObject({name: 'AbortError'});
});
