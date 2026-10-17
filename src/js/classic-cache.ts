import type {ZipFile} from './cache-zip';

export class ClassicCacheWriter {
    private sectors: Uint8Array[] = [new Uint8Array(520)];
    private indexes: Map<number, Uint8Array>[] = Array.from({length: 5}, (): Map<number, Uint8Array> => new Map());

    add(store: number, id: number, bytes: Uint8Array): void {
        if (!Number.isInteger(store) || store < 0 || store > 4 || !Number.isInteger(id) || id < 0 || id > 65535 || !bytes.length || bytes.length > 0xffffff || this.indexes[store].has(id)) throw new Error('Invalid classic cache entry.');
        const count: number = Math.ceil(bytes.length / 512);
        if ((this.sectors.length + count) * 520 > 64 * 1024 * 1024) throw new Error('Classic cache exceeds the 64 MB export limit.');
        const first: number = this.sectors.length;
        const index: Uint8Array = new Uint8Array(6);
        ClassicCacheWriter.p3(index, 0, bytes.length);
        ClassicCacheWriter.p3(index, 3, first);
        this.indexes[store].set(id, index);
        for (let part: number = 0; part < count; part++) {
            const sector: Uint8Array = new Uint8Array(520);
            const header: DataView = new DataView(sector.buffer);
            header.setUint16(0, id);
            header.setUint16(2, part);
            ClassicCacheWriter.p3(sector, 4, part + 1 < count ? first + part + 1 : 0);
            sector[7] = store + 1;
            sector.set(bytes.subarray(part * 512, (part + 1) * 512), 8);
            this.sectors.push(sector);
        }
    }

    files(): ZipFile[] {
        const data: Uint8Array = new Uint8Array(this.sectors.length * 520);
        this.sectors.forEach((sector: Uint8Array, index: number): void => data.set(sector, index * 520));
        const files: ZipFile[] = [{name: 'main_file_cache.dat', bytes: data}];
        this.indexes.forEach((entries: Map<number, Uint8Array>, store: number): void => {
            const ids: number[] = [...entries.keys()];
            const index: Uint8Array = new Uint8Array(ids.length ? (Math.max(...ids) + 1) * 6 : 0);
            for (const [id, entry] of entries) index.set(entry, id * 6);
            files.push({name: `main_file_cache.idx${store}`, bytes: index});
        });
        return files;
    }

    private static p3(dst: Uint8Array, offset: number, value: number): void {
        dst[offset] = value >>> 16;
        dst[offset + 1] = value >>> 8;
        dst[offset + 2] = value;
    }
}
