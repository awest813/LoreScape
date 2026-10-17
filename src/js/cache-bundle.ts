import Packet from './jagex2/io/Packet';

export const cacheNames: string[] = ['main_file_cache.dat', ...[0, 1, 2, 3, 4].map((index: number): string => `main_file_cache.idx${index}`)];
export const cacheLimit: number = 128 * 1024 * 1024;
export type CacheFile = {name: string; bytes: Uint8Array};

export function validateCacheBundle(files: CacheFile[]): CacheFile[] {
    const byName: Map<string, CacheFile> = new Map();
    for (const file of files) {
        if (byName.has(file.name)) throw new Error('More than one cache set was found. Choose a folder or ZIP containing a single cache.');
        byName.set(file.name, file);
    }
    const missing: string[] = cacheNames.filter((name: string): boolean => !byName.has(name));
    if (missing.length) throw new Error(`Incomplete classic cache. Missing: ${missing.join(', ')}. Choose the Classic cache download for Cache viewer/JagEd.`);
    const ordered: CacheFile[] = cacheNames.map((name: string): CacheFile => byName.get(name)!);
    if (ordered[0].bytes.length < 528 || ordered[1].bytes.length < 42 || ordered[2].bytes.length < 6 || ordered.slice(1).some((file: CacheFile): boolean => file.bytes.length % 6 !== 0))
        throw new Error('These files do not have a valid classic cache data/index layout.');
    const data: Uint8Array = ordered[0].bytes;
    for (let store: number = 0; store < 5; store++) {
        const index: Uint8Array = ordered[store + 1].bytes;
        for (let offset: number = 0; offset < index.length; offset += 6) {
            const size: number = (index[offset] << 16) | (index[offset + 1] << 8) | index[offset + 2];
            const sector: number = (index[offset + 3] << 16) | (index[offset + 4] << 8) | index[offset + 5];
            if (!size) continue;
            const start: number = sector * 520;
            if (!sector || start + 8 + Math.min(size, 512) > data.length || ((data[start] << 8) | data[start + 1]) !== offset / 6 || data[start + 2] || data[start + 3] || data[start + 7] !== store + 1)
                throw new Error('The cache data and index files do not match. Choose all files from the same cache.');
        }
    }
    if (ordered.reduce((total: number, file: CacheFile): number => total + file.bytes.length, 0) > cacheLimit) throw new Error('Cache import exceeds the 128 MB limit.');
    return ordered;
}

export function cacheBasename(path: string): string | undefined {
    const normalized: string = path.replace(/\\/g, '/');
    const name: string = normalized.split('/').pop() || '';
    if (!cacheNames.includes(name)) return undefined;
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').some((part: string): boolean => part === '..')) throw new Error('The cache ZIP contains an invalid file path.');
    return name;
}

async function inflate(bytes: Uint8Array, expected: number): Promise<Uint8Array> {
    let stream: DecompressionStream;
    try {
        stream = new DecompressionStream('deflate-raw');
    } catch {
        throw new Error('This browser cannot read compressed ZIPs. Extract the ZIP in Files and choose Open cache folder instead.');
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = new Blob([new Uint8Array(bytes).buffer]).stream().pipeThrough(stream).getReader();
    const output: Uint8Array = new Uint8Array(expected);
    let offset: number = 0;
    try {
        for (;;) {
            const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
            if (chunk.done) break;
            if (offset + chunk.value.length > expected) throw new Error('ZIP entry exceeds its declared size.');
            output.set(chunk.value, offset);
            offset += chunk.value.length;
        }
        if (offset !== expected) throw new Error('ZIP entry is truncated.');
        return output;
    } finally {
        await reader.cancel().catch((): void => {});
        reader.releaseLock();
    }
}

export async function readCacheZip(file: File): Promise<CacheFile[]> {
    if (file.size > cacheLimit) throw new Error('ZIP import exceeds the 128 MB limit.');
    const bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
    const view: DataView = new DataView(bytes.buffer);
    let end: number = -1;
    for (let offset: number = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
        if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
            end = offset;
            break;
        }
    }
    if (end < 0) throw new Error('This file is not a complete ZIP archive.');
    const count: number = view.getUint16(end + 10, true);
    const directorySize: number = view.getUint32(end + 12, true);
    const directoryOffset: number = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || directorySize === 0xffffffff || directoryOffset + directorySize > end)
        throw new Error('Split or ZIP64 caches are unsupported. Extract the ZIP and choose Open cache folder.');
    const entries: Array<{name: string; method: number; crc: number; size: number; packed: number; offset: number}> = [];
    const seen: Set<string> = new Set();
    const parents: Set<string> = new Set();
    let position: number = directoryOffset;
    let total: number = 0;
    for (let index: number = 0; index < count; index++) {
        if (position + 46 > directoryOffset + directorySize || view.getUint32(position, true) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
        const nameLength: number = view.getUint16(position + 28, true);
        const next: number = position + 46 + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
        if (next > directoryOffset + directorySize) throw new Error('The ZIP directory is truncated.');
        const path: string = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
        const name: string | undefined = cacheBasename(path);
        if (name) {
            const normalized: string = path.replace(/\\/g, '/');
            parents.add(normalized.slice(0, normalized.lastIndexOf('/') + 1));
            if (parents.size > 1) throw new Error('Cache files must be together in one folder inside the ZIP.');
            if (seen.has(name)) throw new Error('More than one cache set was found. Choose a ZIP containing a single cache.');
            seen.add(name);
            const flags: number = view.getUint16(position + 8, true);
            const method: number = view.getUint16(position + 10, true);
            const size: number = view.getUint32(position + 24, true);
            const packed: number = view.getUint32(position + 20, true);
            total += size;
            if (flags & 1) throw new Error('Password-protected caches must be extracted before import.');
            if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression. Extract the ZIP and choose Open cache folder.');
            if (total > cacheLimit) throw new Error('Unpacked cache exceeds the 128 MB limit.');
            entries.push({name, method, size, packed, crc: view.getUint32(position + 16, true), offset: view.getUint32(position + 42, true)});
        }
        position = next;
    }
    if (!entries.length) throw new Error('No classic cache files were found in this ZIP. Download Classic cache for Cache viewer/JagEd.');
    const files: CacheFile[] = [];
    for (const entry of entries) {
        const offset: number = entry.offset;
        if (offset + 30 > directoryOffset || view.getUint32(offset, true) !== 0x04034b50) throw new Error('A cache ZIP entry is damaged.');
        const start: number = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
        if (start + entry.packed > directoryOffset) throw new Error('A cache ZIP entry is truncated.');
        const packed: Uint8Array = bytes.subarray(start, start + entry.packed);
        const data: Uint8Array = entry.method === 0 ? packed : await inflate(packed, entry.size);
        if (data.length !== entry.size || Packet.crc32(new Int8Array(data)) >>> 0 !== entry.crc) throw new Error(`ZIP checksum failed for ${entry.name}. Download or copy the ZIP again.`);
        files.push({name: entry.name, bytes: data});
    }
    return validateCacheBundle(files);
}

export async function readCacheFolder(files: ArrayLike<File>): Promise<CacheFile[]> {
    const selected: Array<{file: File; name: string}> = [];
    const parents: Set<string> = new Set();
    let total: number = 0;
    for (const file of Array.from(files)) {
        const name: string | undefined = cacheBasename(file.webkitRelativePath || file.name);
        if (!name) continue;
        const path: string = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
        parents.add(path.slice(0, path.lastIndexOf('/') + 1));
        if (parents.size > 1) throw new Error('Choose a folder containing one cache set, with all six files together.');
        total += file.size;
        if (total > cacheLimit) throw new Error('Cache folder exceeds the 128 MB limit.');
        selected.push({file, name});
    }
    const result: CacheFile[] = [];
    for (const entry of selected) result.push({name: entry.name, bytes: new Uint8Array(await entry.file.arrayBuffer())});
    return validateCacheBundle(result);
}
