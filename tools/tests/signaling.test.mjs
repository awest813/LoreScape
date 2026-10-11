import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createSignalingService } from '../signaling.mjs';
import { validateWorld } from '../../src/public/coop/storage.mjs';
import { validateGameMessage, validateSettings, isNpcLoot, lootCount } from '../../src/public/coop/protocol.mjs';

async function fixture(options = {}) {
    const server = http.createServer(); const service = createSignalingService(server, { iceServers: [], ...options });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const clients = [];
    async function client() {
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/signal`); clients.push(ws);
        const queue = [], waiting = [];
        ws.on('message', raw => { const message = JSON.parse(raw); const index = waiting.findIndex(item => item.type === message.type); if (index >= 0) waiting.splice(index, 1)[0].resolve(message); else queue.push(message); });
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
        return { ws, send: message => ws.send(JSON.stringify(message)), wait: type => {
            const index = queue.findIndex(message => message.type === type); if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
            return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000); waiting.push({ type, resolve: message => { clearTimeout(timer); resolve(message); } }); });
        } };
    }
    return { service, client, close: async () => { for (const ws of clients) ws.terminate(); service.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('room reservations enforce four players, authorize host actions, and bind relay identities', async () => {
    const f = await fixture();
    try {
        const host = await f.client(); host.send({ type: 'create', worldId: 'world1' }); const room = await host.wait('created');
        assert.match(room.code, /^[A-HJ-NP-Z2-9]{8}$/); assert.equal(room.token.length, 64);
        const guests = [];
        for (let i = 0; i < 3; i++) { const guest = await f.client(); guest.send({ type: 'join', code: room.code }); guests.push({ ...guest, ...(await guest.wait('joined')) }); }
        guests[0].send({ type: 'ready' }); assert.equal((await host.wait('guest-ready')).id, guests[0].id);
        guests[0].send({ type: 'ready' }); assert.match((await guests[0].wait('error')).message, /already started/);
        const extra = await f.client(); extra.send({ type: 'join', code: room.code }); assert.match((await extra.wait('error')).message, /full/);
        guests[0].send({ type: 'settings', token: room.token, settings: { xpRate: 10, lootRate: 5, lootMode: 'shared' } }); assert.match((await guests[0].wait('error')).message, /authorization/);
        host.send({ type: 'settings', token: '0'.repeat(64), settings: { xpRate: 10, lootRate: 5, lootMode: 'shared' } }); assert.match((await host.wait('error')).message, /authorization/);
        assert.equal(f.service.rooms.get(room.code).settings.xpRate, 1);
        guests[0].send({ type: 'offer', to: guests[1].id, sdp: 'forged' }); assert.match((await guests[0].wait('error')).message, /participant/);
        guests[0].send({ type: 'relay', message: { type: 'connection', id: room.id } }); assert.match((await guests[0].wait('error')).message, /admitted/);
        host.send({ type: 'relay-open', to: guests[0].id }); await guests[0].wait('relay-open');
        guests[0].send({ type: 'relay', message: { type: 'connection', id: room.id } }); const relayed = await host.wait('relay');
        assert.equal(relayed.id, guests[0].id); assert.deepEqual(relayed.message, { type: 'connection' });
        guests[0].send({ type: 'relay', message: { type: 'coop-settings', settings: { xpRate: 10 } } }); assert.match((await guests[0].wait('error')).message, /game message/);
        host.send({ type: 'kick', token: room.token, to: guests[2].id }); assert.match((await guests[2].wait('ended')).reason, /removed/);
        extra.send({ type: 'join', code: room.code }); assert.equal((await extra.wait('joined')).code, room.code);
        host.ws.close(); assert.match((await guests[0].wait('ended')).reason, /host has left/);
        assert.equal(f.service.rooms.size, 0);
    } finally { await f.close(); }
});

test('expired negotiations release slots and expired rooms reject old codes', async () => {
    let now = 1000; const f = await fixture({ clock: () => now, reservationMs: 100, roomMs: 1000 });
    try {
        const host = await f.client(); host.send({ type: 'create', worldId: 'world2' }); const room = await host.wait('created');
        const guest = await f.client(); guest.send({ type: 'join', code: room.code }); await guest.wait('joined');
        now += 101; f.service.sweep(); assert.match((await guest.wait('ended')).reason, /timed out/); assert.equal(f.service.rooms.get(room.code).guests.size, 0);
        now += 1000; f.service.sweep(); assert.match((await host.wait('ended')).reason, /expired/);
        guest.send({ type: 'join', code: room.code }); assert.match((await guest.wait('error')).message, /invalid or expired/);
    } finally { await f.close(); }
});

test('invalid settings and oversized or malformed worker packets are rejected', () => {
    assert.throws(() => validateSettings({ xpRate: 999, lootRate: 1, lootMode: 'killer' }));
    assert.throws(() => validateSettings({ xpRate: 1, lootRate: 1, lootMode: 'killer', admin: true }));
    assert.throws(() => validateGameMessage({ type: 'data', data: [256] }));
    assert.throws(() => validateGameMessage({ type: 'data', data: new Array(5001).fill(1) }));
});

test('loot bonuses apply only to NPC death drops and tradable items', () => {
    const state = { script: { info: { scriptName: '[proc,default_drop]' } }, frames: [{ script: { info: { scriptName: '[ai_queue3,_guard]' } } }], fp: 1 };
    assert.equal(isNpcLoot(state), true);
    assert.equal(isNpcLoot({ ...state, fp: 0 }), false);
    const settings = { xpRate: 2, lootRate: 3, lootMode: 'shared' };
    assert.equal(lootCount(2, true, isNpcLoot(state), settings), 6);
    assert.equal(lootCount(2, false, isNpcLoot(state), settings), 2);
    assert.equal(lootCount(2, true, false, settings), 2);
});

// Shops retain stock entries at quantity zero; these must survive a world save.
test('world snapshots preserve exhausted shop stock and reject negative quantities', () => {
    const world = { version: 1, tick: 10, vars: [0], strings: [''], inventories: [{type: 1, items: [{id: 995, count: 0}, null]}] };
    assert.doesNotThrow(() => validateWorld(world));
    world.inventories[0].items[0].count = -1;
    assert.throws(() => validateWorld(world), /inventory/);
    world.inventories[0].items[0].count = 0; world.inventories.push(structuredClone(world.inventories[0]));
    assert.throws(() => validateWorld(world), /Duplicate/);
});
