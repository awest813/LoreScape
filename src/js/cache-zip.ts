import Packet from './jagex2/io/Packet';

export type ZipFile = {name: string; bytes: Uint8Array};

// Archives are already compressed; ZIP STORE avoids recompressing them on small devices.
export function createCacheZip(files: ZipFile[]): Blob {
    if (!files.length || files.length > 65535) throw new Error('Invalid number of cache files.');
    const parts: BlobPart[] = [];
    const directory: BlobPart[] = [];
    const names: Set<string> = new Set();
    let offset: number = 0;
    let directoryLength: number = 0;
    for (const file of files) {
        if (!file.name || file.name.startsWith('/') || file.name.includes('\\') || file.name.split('/').some((part: string): boolean => part === '..' || part === '.') || names.has(file.name)) throw new Error('Invalid cache ZIP filename.');
        names.add(file.name);
        const name: Uint8Array = new TextEncoder().encode(file.name);
        if (name.length > 65535 || file.bytes.length > 0xffffffff) throw new Error('Cache file is too large.');
        const crc: number = Packet.crc32(new Int8Array(file.bytes));
        const local: ArrayBuffer = new ArrayBuffer(30);
        const header: DataView = new DataView(local);
        header.setUint32(0, 0x04034b50, true);
        header.setUint16(4, 20, true);
        header.setUint16(6, 0x0800, true);
        header.setUint16(12, 33, true); // 1980-01-01, valid on ChromeOS ZIP readers.
        header.setUint32(14, crc, true);
        header.setUint32(18, file.bytes.length, true);
        header.setUint32(22, file.bytes.length, true);
        header.setUint16(26, name.length, true);
        parts.push(local, new Uint8Array(name).buffer, new Uint8Array(file.bytes).buffer);
        const central: ArrayBuffer = new ArrayBuffer(46);
        const record: DataView = new DataView(central);
        record.setUint32(0, 0x02014b50, true);
        record.setUint16(4, 20, true);
        record.setUint16(6, 20, true);
        record.setUint16(8, 0x0800, true);
        record.setUint16(14, 33, true);
        record.setUint32(16, crc, true);
        record.setUint32(20, file.bytes.length, true);
        record.setUint32(24, file.bytes.length, true);
        record.setUint16(28, name.length, true);
        record.setUint32(42, offset, true);
        directory.push(central, new Uint8Array(name).buffer);
        directoryLength += 46 + name.length;
        offset += 30 + name.length + file.bytes.length;
        if (offset + directoryLength > 0xffffffff) throw new Error('Cache ZIP is too large.');
    }
    const end: ArrayBuffer = new ArrayBuffer(22);
    const trailer: DataView = new DataView(end);
    trailer.setUint32(0, 0x06054b50, true);
    trailer.setUint16(8, files.length, true);
    trailer.setUint16(10, files.length, true);
    trailer.setUint32(12, directoryLength, true);
    trailer.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], {type: 'application/zip'});
}
