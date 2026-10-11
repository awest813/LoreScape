import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {clientCrcTable, writeClientCrc} from '../client-crc.mjs';

test('first clean pack replaces zero login CRCs and detects later archive changes', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'lorescape-crc-'));
    const directory = path.join(base, 'data/pack/client');
    mkdirSync(directory, {recursive: true});
    try {
        for (const archive of ['title', 'config', 'interface', 'media', 'models', 'textures', 'wordenc', 'sounds']) writeFileSync(path.join(directory, archive), '123456789');
        writeFileSync(path.join(directory, 'crc'), Buffer.alloc(36));
        writeClientCrc(base);
        const result = readFileSync(path.join(directory, 'crc'));
        assert.equal(result.length, 36);
        assert.equal(result.readUInt32BE(0), 0);
        for (let index = 1; index < 9; index++) assert.equal(result.readUInt32BE(index * 4), 0xcbf43926); // Standard CRC-32 vector.
        writeFileSync(path.join(directory, 'models'), 'changed');
        assert(!result.equals(clientCrcTable(base)));
        writeClientCrc(base);
        assert(readFileSync(path.join(directory, 'crc')).equals(clientCrcTable(base)));
    } finally { rmSync(base, {recursive: true, force: true}); }
});
