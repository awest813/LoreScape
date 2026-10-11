import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCharacter, crc32, SaveStore} from '../../src/public/coop/storage.mjs';
import {validatePreferences} from '../../src/public/coop/preferences.mjs';

function character() {
    const bytes = new Uint8Array(144);
    bytes.set([0x20, 4, 0, 5]);
    new DataView(bytes.buffer).setUint32(140, crc32(bytes.subarray(0, 140)));
    return bytes;
}
test('character import rejects CRC-valid truncated framing and trailing data', () => {
    assert.doesNotThrow(() => validateCharacter(character()));
    const bad = character();
    new DataView(bad.buffer).setUint16(133, 100);
    new DataView(bad.buffer).setUint32(140, crc32(bad.subarray(0, 140)));
    assert.throws(() => validateCharacter(bad), /Truncated/);
    const extra = new Uint8Array(145);
    extra.set(character());
    new DataView(extra.buffer).setUint32(141, crc32(extra.subarray(0, 141)));
    assert.throws(() => validateCharacter(extra), /length/);
});
test('character names cannot read inherited properties or mutate dictionary prototypes', () => {
    const store = new SaveStore();
    const data = store.newWorld('Test');
    assert.equal(store.character(data, 'constructor').length, 0);
    store.setCharacter(data, '__proto__', character());
    store.setCharacter(data, 'constructor', character());
    assert.equal(Object.getPrototypeOf(data.characters), Object.prototype);
    assert.equal(store.character(data, '__proto__').length, 144);
    assert.equal(store.character(data, 'constructor').length, 144);
});
test('device preferences accept only bounded rendering choices', () => {
    assert.deepEqual(validatePreferences({detail: 'low', fps: 15, scale: 'fit', mute: true}), {detail: 'low', fps: 15, scale: 'fit', mute: true});
    for (const bad of [
        {detail: 'low', fps: 0, scale: 'fit', mute: true},
        {detail: 'ultra', fps: 30, scale: 'fit', mute: true},
        {detail: 'low', fps: 30, scale: 'huge', mute: true}
    ])
        assert.throws(() => validatePreferences(bad));
});
test('portable backups canonicalize sparse world strings and recover legacy null slots', async () => {
    const store = new SaveStore();
    const data = store.newWorld('Sparse world');
    data.world = {version: 1, tick: 12, vars: [0], strings: new Array(3), inventories: []};
    data.world.strings[1] = 'A permanent world string';
    const archive = await store.exportData(data);
    assert.deepEqual((await store.inspect(archive)).world.strings, ['', 'A permanent world string', '']);
    assert.deepEqual(JSON.parse(archive).snapshot.data.world.strings, ['', 'A permanent world string', '']);
    assert.equal(0 in data.world.strings, false, 'Export mutated its input');
    const legacy = JSON.parse(archive);
    legacy.snapshot.data.world.strings = [null, 'A permanent world string', null];
    legacy.snapshot.checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(legacy.snapshot.data))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    assert.deepEqual((await store.inspect(JSON.stringify(legacy))).world.strings, ['', 'A permanent world string', '']);
    legacy.snapshot.data.world.strings[1] = 'Tampered';
    await assert.rejects(store.inspect(JSON.stringify(legacy)), /checksum/);
    data.world.strings = [9];
    await assert.rejects(store.exportData(data), /world snapshot/);
});
