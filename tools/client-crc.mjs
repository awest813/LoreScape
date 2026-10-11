import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {crc32} from '../src/public/coop/storage.mjs';

const archives = ['title', 'config', 'interface', 'media', 'models', 'textures', 'wordenc', 'sounds'];
export function clientCrcTable(directory) {
    const table = Buffer.alloc(36);
    for (const [index, archive] of archives.entries()) {
        table.writeUInt32BE(crc32(readFileSync(path.join(directory, 'data/pack/client', archive))), (index + 1) * 4);
    }
    return table;
}
export function writeClientCrc(directory) {
    writeFileSync(path.join(directory, 'data/pack/client/crc'), clientCrcTable(directory));
}
