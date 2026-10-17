import { DEFAULT_SETTINGS, validateSettings } from '../src/public/coop/protocol.mjs';
import { validateWorld } from '../src/public/coop/storage.mjs';

export function installCoop(World, Login) {
    const pending = new Map();
    const tasks = [];
    const admissions = new Set();
    let hostId = null, savedAt = Date.now(), checkpointBusy = false, lastRoster = '';
    let loaded;
    const state = { settings: { ...DEFAULT_SETTINGS }, admissions, tick };
    globalThis.__coop = state;
    function storage(action, payload = {}) {
        return new Promise((resolve, reject) => {
            const requestId = 'root:' + crypto.randomUUID();
            const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Host storage timed out')); }, 30000);
            pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
            self.postMessage({ type: 'coop-storage', action, requestId, ...payload });
        });
    }
    function worldSnapshot() {
        return { version: 1, tick: World.currentTick, vars: Array.from(World.vars), strings: Array.from(World.varsString, value => value ?? ''), inventories: [...World.invs].map(inv => ({ type: inv.type, items: Array.from(inv.items, item => item ? { id: item.id, count: item.count } : null) })) };
    }
    function characters() {
        const result = [];
        for (const player of World.players) { const packet = player.save(); result.push({ name: player.username, bytes: Array.from(packet.data.subarray(0, packet.pos)) }); packet.release(); }
        return result;
    }
    async function checkpoint() {
        await storage('checkpoint', { characters: characters(), world: worldSnapshot(), settings: state.settings });
        savedAt = Date.now();
    }
    function tick() {
        const task = !checkpointBusy ? tasks.shift() : null;
        if (task) {
            checkpointBusy = true;
            const previousSettings = state.settings;
            (async () => {
                try {
                    if (task.type === 'coop-settings') state.settings = validateSettings(task.settings);
                    await checkpoint(); self.postMessage({ type: 'coop-result', requestId: task.requestId, value: state.settings });
                } catch (error) {
                    state.settings = previousSettings;
                    self.postMessage({ type: 'coop-result', requestId: task.requestId, error: error.message });
                } finally { checkpointBusy = false; }
            })();
        } else if (!checkpointBusy && Date.now() - savedAt >= 30000) {
            checkpointBusy = true;
            checkpoint().catch(error => self.postMessage({ type: 'coop-error', error: error.message })).finally(() => { checkpointBusy = false; savedAt = Date.now(); });
        }
        const players = [...World.players].map(player => ({ id: player.client?.uniqueId || '', name: player.username }));
        const roster = JSON.stringify(players);
        if (roster !== lastRoster) { lastRoster = roster; self.postMessage({ type: 'coop-party', players, hostName: players.find(player => player.id === hostId)?.name || '' }); }
    }
    self.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'coop-storage-result') {
            if (msg.requestId.startsWith('login:')) { Login.loginThread.postMessage(msg); return; }
            const request = pending.get(msg.requestId); if (request) { pending.delete(msg.requestId); msg.error ? request.reject(new Error(msg.error)) : request.resolve(msg.value); }
        } else if (msg.type === 'coop-host' && !hostId) { hostId = msg.id; admissions.add(msg.id); }
        else if (msg.type === 'coop-admit' && typeof msg.id === 'string' && admissions.size < 4) admissions.add(msg.id);
        else if (msg.type === 'coop-revoke' && msg.id !== hostId) {
            admissions.delete(msg.id);
            for (const player of World.players) if (player.client?.uniqueId === msg.id) World.removePlayer(player);
            self.dispatchEvent(new MessageEvent('message', { data: { type: 'close', id: msg.id } }));
        } else if (msg.type === 'coop-checkpoint' || msg.type === 'coop-settings') tasks.push(msg);
    });
    return {
        async load() {
            loaded = await storage('load-world'); state.settings = validateSettings(loaded.settings);
            if (loaded.world) { validateWorld(loaded.world); World.currentTick = loaded.world.tick; }
        },
        async restore() {
            const saved = loaded;
            if (!saved.world) return;
            const world = saved.world; validateWorld(world);
            if (world.vars.length !== World.vars.length || world.strings.length !== World.varsString.length) throw new Error('World snapshot does not match this engine version');
            for (const record of world.inventories) { const inv = [...World.invs].find(inv => inv.type === record.type); if (!inv || inv.capacity !== record.items.length) throw new Error('Inventory snapshot does not match this engine version'); }
            World.currentTick = world.tick; World.vars.set(world.vars); World.varsString = world.strings.slice();
            for (const record of world.inventories) { const inv = [...World.invs].find(inv => inv.type === record.type); record.items.forEach((item, slot) => inv.set(slot, item)); }
        }
    };
}
