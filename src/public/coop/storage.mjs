import {DEFAULT_SETTINGS, validateSettings} from './protocol.mjs';

const DB_NAME = 'lorescape-coop-v1';
const MAX_ARCHIVE = 20 * 1024 * 1024;
export function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
export function validateCharacter(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 144 || bytes.length > 1024 * 1024 || bytes[0] !== 0x20 || bytes[1] !== 4 || bytes[2] !== 0 || bytes[3] !== 5) throw new Error('Invalid character save format');
    const stored = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4);
    if (crc32(bytes.subarray(0, -4)) !== stored) throw new Error('Character checksum failed');
    // Validate the v5 framing before the engine parses an imported save.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 4;
    let position = 133;
    function take(size) {
        if (position + size > end) throw new Error('Truncated character save');
        const start = position;
        position += size;
        return start;
    }
    const variables = view.getUint16(take(2));
    take(variables * 4);
    const inventories = view.getUint8(take(1));
    for (let inv = 0; inv < inventories; inv++) {
        take(2);
        const capacity = view.getUint16(take(2));
        if (capacity > 1000) throw new Error('Invalid character inventory');
        for (let slot = 0; slot < capacity; slot++) if (view.getUint16(take(2)) && view.getUint8(take(1)) === 255) take(4);
    }
    take(view.getUint8(take(1)) * 4);
    take(3);
    if (position !== end) throw new Error('Invalid character save length');
}
function encode(bytes) {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}
function decode(text) {
    if (typeof text !== 'string' || text.length > 1400000) throw new Error('Invalid character data');
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}
async function checksum(data) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function canonicalData(data) {
    if (data?.world && Array.isArray(data.world.strings) && data.world.strings.length <= 65536) return {...data, world: {...data.world, strings: Array.from(data.world.strings, value => value ?? '')}};
    return data;
}
export function validateWorld(world) {
    if (world === null) return;
    if (
        !world ||
        world.version !== 1 ||
        !Number.isInteger(world.tick) ||
        world.tick < 0 ||
        world.tick > 2 ** 31 - 1 ||
        !Array.isArray(world.vars) ||
        world.vars.length > 65536 ||
        !world.vars.every(Number.isInteger) ||
        !Array.isArray(world.strings) ||
        world.strings.length > 65536 ||
        !world.strings.every(value => typeof value === 'string' && value.length < 8192) ||
        !Array.isArray(world.inventories) ||
        world.inventories.length > 4096
    )
        throw new Error('Invalid world snapshot');
    const types = new Set();
    for (const inv of world.inventories) {
        if (
            !Number.isInteger(inv.type) ||
            inv.type < 0 ||
            inv.type > 65535 ||
            !Array.isArray(inv.items) ||
            inv.items.length > 1000 ||
            !inv.items.every(item => item === null || (Number.isInteger(item.id) && item.id >= 0 && item.id <= 65535 && Number.isInteger(item.count) && item.count >= 0 && item.count <= 0x7fffffff))
        )
            throw new Error('Invalid inventory snapshot');
        if (types.has(inv.type)) throw new Error('Duplicate inventory snapshot');
        types.add(inv.type);
    }
}
async function validateEnvelope(envelope) {
    if (!envelope || typeof envelope.checksum !== 'string' || !envelope.data || (await checksum(envelope.data)) !== envelope.checksum) throw new Error('Backup checksum failed');
    // Older snapshots preserved sparse uninitialized world-string slots.
    // JSON turns those holes into null. Verify the original checksum first,
    // then canonicalize empty slots without mutating the checked envelope.
    const data = canonicalData(envelope.data);
    if (
        data.version !== 1 ||
        typeof data.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(data.id) ||
        typeof data.name !== 'string' ||
        data.name.length < 1 ||
        data.name.length > 60 ||
        !data.characters ||
        typeof data.characters !== 'object' ||
        Array.isArray(data.characters) ||
        Object.keys(data.characters).length > 200
    )
        throw new Error('Unsupported backup format');
    validateSettings(data.settings);
    validateWorld(data.world);
    for (const [name, text] of Object.entries(data.characters)) {
        if (!/^[a-z0-9_]{1,12}$/.test(name)) throw new Error('Invalid character name');
        validateCharacter(decode(text));
    }
    return data;
}
export class SaveStore {
    constructor() {
        this.queue = Promise.resolve();
    }
    async open() {
        if (this.db) return this.db;
        if (this.opening) return this.opening;
        this.opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            let blocked = false;
            request.onupgradeneeded = () => request.result.createObjectStore('worlds', {keyPath: 'id'});
            request.onsuccess = () => {
                if (blocked) {
                    request.result.close();
                    return;
                }
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    this.db = null;
                };
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
                blocked = true;
                reject(new Error('Close other LoreScape tabs to open storage'));
            };
        });
        try {
            this.db = await this.opening;
        } finally {
            this.opening = null;
        }
        return this.db;
    }
    async read(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const request = db.transaction('worlds').objectStore('worlds').get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async list() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const request = db.transaction('worlds').objectStore('worlds').getAll();
            request.onsuccess = () => resolve(request.result.map(record => ({id: record.id, name: record.name, updated: record.updated})));
            request.onerror = () => reject(request.error);
        });
    }
    async load(id) {
        const record = await this.read(id);
        if (!record) return null;
        if (!Array.isArray(record.history)) throw new Error('Invalid saved-world record. Import an exported backup.');
        for (let index = 0; index < record.history.length; index++) {
            try {
                return {data: await validateEnvelope(record.history[index]), recovered: index > 0, backupIndex: index};
            } catch {}
        }
        throw new Error('All snapshots failed validation. Import a valid exported backup.');
    }
    commit(data) {
        const snapshot = canonicalData(structuredClone(data));
        const operation = this.queue.then(async () => {
            const envelope = {data: snapshot, checksum: await checksum(snapshot)};
            await validateEnvelope(envelope);
            const db = await this.open();
            await new Promise((resolve, reject) => {
                const tx = db.transaction('worlds', 'readwrite');
                const store = tx.objectStore('worlds');
                const request = store.get(snapshot.id);
                request.onsuccess = () => {
                    const history = request.result?.history || [];
                    store.put({id: snapshot.id, name: snapshot.name, updated: Date.now(), history: [envelope, ...history].slice(0, 3)});
                };
                tx.oncomplete = () => resolve();
                tx.onabort = tx.onerror = () => reject(tx.error || new Error('Save transaction interrupted'));
            });
            return envelope;
        });
        this.queue = operation.catch(() => {});
        return operation;
    }
    newWorld(name) {
        return {version: 1, id: crypto.randomUUID(), name: name.trim().slice(0, 60) || 'My world', settings: {...DEFAULT_SETTINGS}, characters: {}, world: null};
    }
    character(data, name) {
        return Object.hasOwn(data.characters, name) ? decode(data.characters[name]) : new Uint8Array();
    }
    setCharacter(data, name, bytes) {
        if (!/^[a-z0-9_]{1,12}$/.test(name)) throw new Error('Invalid character name');
        bytes = new Uint8Array(bytes);
        validateCharacter(bytes);
        Object.defineProperty(data.characters, name, {value: encode(bytes), enumerable: true, writable: true, configurable: true});
    }
    async rename(id, name) {
        const loaded = await this.load(id);
        if (!loaded) throw new Error('World not found');
        loaded.data.name = name.trim().slice(0, 60);
        if (!loaded.data.name) throw new Error('Enter a world name');
        await this.commit(loaded.data);
        return loaded.data;
    }
    async remove(id) {
        const db = await this.open();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('worlds', 'readwrite');
            tx.objectStore('worlds').delete(id);
            tx.oncomplete = resolve;
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Delete failed'));
        });
    }
    async exportData(data) {
        const captured = canonicalData(structuredClone(data));
        const snapshot = {data: captured, checksum: await checksum(captured)};
        await validateEnvelope(snapshot);
        return JSON.stringify({format: 'lorescape-backup', version: 1, snapshot}, null, 2);
    }
    async export(id) {
        const loaded = await this.load(id);
        if (!loaded) throw new Error('World not found');
        return this.exportData(loaded.data);
    }
    async inspect(text) {
        if (typeof text !== 'string' || text.length > MAX_ARCHIVE) throw new Error('Backup is too large');
        const archive = JSON.parse(text);
        if (archive.format !== 'lorescape-backup' || archive.version !== 1) throw new Error('Unsupported archive version');
        return structuredClone(await validateEnvelope(archive.snapshot));
    }
    async import(text, replace = false) {
        const data = await this.inspect(text);
        if (!replace || !(await this.read(data.id))) data.id = crypto.randomUUID();
        await this.commit(data);
        return data;
    }
    async recover(id) {
        const record = await this.read(id);
        if (!record || record.history.length < 2) throw new Error('No earlier snapshot is available');
        for (const envelope of record.history.slice(1)) {
            let data;
            try {
                data = await validateEnvelope(envelope);
            } catch {
                continue;
            }
            await this.commit(data);
            return data;
        }
        throw new Error('No valid earlier snapshot is available');
    }
}
