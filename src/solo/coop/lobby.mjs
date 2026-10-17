import {SaveStore} from './storage.mjs';
import {validateSettings} from './protocol.mjs';
import {loadPreferences, savePreferences} from './preferences.mjs';
import {offlineAction} from './offline.mjs';

const store = new SaveStore();
const $ = id => document.getElementById(id);
let session = null,
    socket = null,
    importText = null,
    releaseLock = null;
let preferences = loadPreferences(),
    opening = false,
    deleteTarget = null,
    persistentStorage = false,
    fullscreenRequest = 0;
function openingState(value) {
    opening = value;
    for (const id of ['host', 'solo', 'join']) $(id).disabled = value;
    updateLaunch();
}
function updateLaunch() {
    const saved = !!$('worlds').value;
    $('worldNameLabel').hidden = saved;
    $('launchHeading').textContent = saved ? 'Welcome back, adventurer' : 'Begin a new world';
    $('solo').textContent = opening ? 'Opening adventure…' : saved ? 'Continue adventure →' : 'Play adventure →';
    $('solo').setAttribute('aria-busy', String(opening));
}
function notice(text, error = false) {
    $('notice').textContent = text;
    $('notice').classList.toggle('error', error);
    $('fullscreenStatus').textContent = text;
    $('fullscreenStatus').title = text;
    $('fullscreenStatus').classList.toggle('error', error);
}
function beginStartup() {
    const current = session;
    current.startup = {client: false, progress: 0, failed: false};
    $('startupTitle').textContent = 'Starting adventure…';
    $('startupMessage').textContent = 'Loading game files and starting the world.';
    $('startupHint').textContent = 'The first visit takes longer while game files download. Your saves stay on this device.';
    $('startupPanel').hidden = false;
    $('gameStage').inert = true;
    $('cancelStartup').focus({preventScroll: true});
    $('retryStartup').hidden = true;
    $('startupProgress').value = 0;
    $('gameViewport').classList.add('starting');
    $('gameViewport').setAttribute('aria-busy', 'true');
    current.startup.timer = setTimeout(() => {
        if (session !== current || $('startupPanel').hidden || current.startup.failed) return;
        $('startupTitle').textContent = 'Taking longer than usual';
        $('startupHint').textContent = 'Files are still loading. You can keep waiting, retry, or return to the launcher without deleting your save.';
        $('retryStartup').hidden = false;
    }, 45000);
    updateStartup();
}
function updateStartup() {
    if (!session?.startup || session.startup.failed) return;
    const startup = session.startup;
    const serverReady = session.solo ? session.ready : !!session.transport?.uniqueId;
    $('startupClient').textContent = startup.client ? 'Game client · ready' : `Game client · ${Math.round(startup.progress)}% loaded`;
    $('startupServer').textContent = serverReady ? 'World simulation · ready' : 'World simulation · starting';
    $('startupProgress').value = startup.client ? 100 : startup.progress;
    if (startup.client && serverReady) {
        clearTimeout(startup.timer);
        const moveFocus = $('startupPanel').contains(document.activeElement);
        $('startupPanel').hidden = true;
        $('gameStage').inert = false;
        if (moveFocus) $('game').contentWindow.document.querySelector('canvas')?.focus();
        $('gameViewport').classList.remove('starting');
        $('gameViewport').setAttribute('aria-busy', 'false');
        notice(session.autoPlay ? 'Your private offline adventure is ready. Progress saves on this device.' : 'World ready. Select Existing User and enter your character name.');
    }
}
function startupFailure(message) {
    if (!session?.startup || $('startupPanel').hidden) return notice(message, true);
    session.startup.failed = true;
    clearTimeout(session.startup.timer);
    $('startupTitle').textContent = 'Your world could not start';
    $('startupMessage').textContent = message;
    $('startupHint').textContent = 'Retry startup or return to the launcher. Your saved world is kept.';
    $('retryStartup').hidden = false;
    $('gameViewport').setAttribute('aria-busy', 'false');
    notice(message, true);
}
async function refreshWorlds(selected = '') {
    const worlds = await store.list();
    $('worlds').replaceChildren(new Option('Create a new world', ''));
    for (const world of worlds.sort((a, b) => b.updated - a.updated)) $('worlds').add(new Option(world.name, world.id));
    $('worlds').value = selected;
    await worldInfo();
}
async function worldInfo() {
    const id = $('worlds').value;
    updateLaunch();
    for (const button of ['export', 'recover', 'rename', 'delete']) $(button).disabled = !id;
    if (!id) {
        $('worldInfo').textContent = 'Create a world to start an adventure.';
        return;
    }
    const loaded = await store.load(id);
    if ($('worlds').value !== id) return;
    if (!loaded) return;
    $('worldName').value = loaded.data.name;
    const names = Object.keys(loaded.data.characters);
    $('worldInfo').textContent = `${names.length} saved character${names.length === 1 ? '' : 's'}${names.length ? ': ' + names.join(', ') : ''}.${loaded.recovered ? ' Latest snapshot damaged; an earlier valid snapshot will load.' : ''}`;
}
function send(message) {
    if (session?.solo) {
        if (message.type === 'presence' || message.type === 'settings')
            receive({
                type: 'roster',
                settings: session.data.settings,
                roster: [
                    {
                        id: session.id,
                        host: true,
                        name: message.name || session.characterName || 'Solo',
                        state: message.playing || session.characterName ? 'playing' : 'ready'
                    }
                ]
            }).catch(error => notice(error.message, true));
        return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Room service disconnected');
    socket.send(
        JSON.stringify({
            ...message,
            ...(session?.token ? {token: session.token} : {})
        })
    );
}
async function connect() {
    if (socket?.readyState === WebSocket.OPEN) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`);
    const current = socket;
    socket.onmessage = event => {
        if (current !== socket) return;
        try {
            receive(JSON.parse(event.data)).catch(error => notice(error.message, true));
        } catch {
            notice('Invalid room service message', true);
        }
    };
    socket.onclose = () => {
        if (current !== socket || session?.solo) return;
        $('connection').textContent = 'Disconnected';
        openingState(false);
        if (session) endLocal('Connection to room service lost. Reopen the saved world or rejoin.');
        else if (window.pendingWorld) {
            releaseLock?.();
            releaseLock = null;
            window.pendingWorld = null;
        }
    };
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('Could not connect to the room service'));
    });
    $('connection').textContent = 'Connected';
}
async function lockWorld(id) {
    if (releaseLock) throw new Error('A saved-world operation is already running');
    if (!navigator.locks) throw new Error('Hosting requires a browser with Web Locks support');
    let readyResolve;
    const ready = new Promise(resolve => {
        readyResolve = resolve;
    });
    navigator.locks
        .request(`lorescape-world:${id}`, {ifAvailable: true}, lock => {
            if (!lock) {
                readyResolve(false);
                return;
            }
            return new Promise(resolve => {
                releaseLock = resolve;
                readyResolve(true);
            });
        })
        .catch(() => readyResolve(false));
    if (!(await ready)) throw new Error('This world is already hosted in another tab');
}
async function start(message, role, data) {
    // Hold a shared asset lock for the whole session, including guest tabs.
    // Offline updates/removal take the exclusive lock in the service worker.
    let releaseAssets;
    if (navigator.locks) {
        await new Promise((resolve, reject) => {
            navigator.locks
                .request('lorescape-offline-assets', {mode: 'shared', ifAvailable: true}, lock => {
                    if (!lock) throw new Error('Wait for the offline operation to finish before playing');
                    return new Promise(release => {
                        releaseAssets = release;
                        resolve();
                    });
                })
                .catch(reject);
        });
    }
    if (!message.solo && socket?.readyState !== WebSocket.OPEN) {
        releaseAssets?.();
        throw new Error('Room service disconnected while starting');
    }
    if (message.solo) {
        const previous = socket;
        socket = null;
        previous?.close();
    }
    const transportMode = $('transport').value;
    session = {
        ...message,
        role,
        data,
        transportMode,
        releaseAssets,
        preferences,
        ready: false,
        worker: null,
        transport: null,
        signals: [],
        requests: new Map(),
        saveQueue: Promise.resolve(),
        send,
        attachTransport(transport) {
            this.transport = transport;
            for (const signal of this.signals.splice(0)) transport.signal(signal);
        },
        signal(signal) {
            if (this.transport) this.transport.signal(signal);
            else this.signals.push(signal);
        },
        notify(text, error = false) {
            notice(text, error);
        },
        attachWorker(worker) {
            this.worker = worker;
            worker.addEventListener('message', event => {
                if (session !== this) return;
                const msg = event.data;
                if (msg.type === 'coop-storage') this.storage(msg);
                if (msg.type === 'coop-result') {
                    const request = this.requests.get(msg.requestId);
                    if (request) {
                        this.requests.delete(msg.requestId);
                        msg.error ? request.reject(new Error(msg.error)) : request.resolve(msg.value);
                    }
                }
                if (msg.type === 'coop-party') {
                    this.characterName = msg.hostName;
                    send({
                        type: 'presence',
                        name: msg.hostName || 'Host',
                        playing: !!msg.hostName
                    });
                    this.transport?.updatePresence(msg.players);
                }
                if (msg.type === 'coop-error') startupFailure(msg.error);
                if (msg.type === 'ready') {
                    this.ready = true;
                    this.transport?.onWorkerReady();
                    $('save').disabled = false;
                    $('applySettings').disabled = false;
                    updateStartup();
                }
            });
            worker.addEventListener('error', () => {
                if (session === this) startupFailure('World simulation failed to start. Your latest committed save is safe.');
            });
        },
        async storage(msg) {
            this.saveQueue = this.saveQueue.then(async () => {
                try {
                    let value;
                    if (msg.action === 'load-character') value = Array.from(store.character(this.pendingData || this.data, msg.name));
                    else if (msg.action === 'load-world')
                        value = {
                            world: this.data.world,
                            settings: this.data.settings
                        };
                    else if (msg.action === 'checkpoint') {
                        const candidate = structuredClone(this.data);
                        // A failed logout save must survive later checkpoints when
                        // that character is no longer present in the worker.
                        for (const [name, bytes] of Object.entries(this.pendingData?.characters || {}))
                            Object.defineProperty(candidate.characters, name, {
                                value: bytes,
                                enumerable: true,
                                writable: true,
                                configurable: true
                            });
                        for (const character of msg.characters || []) store.setCharacter(candidate, character.name, character.bytes);
                        if (msg.world) candidate.world = msg.world;
                        if (msg.settings) candidate.settings = validateSettings(msg.settings);
                        this.pendingData = candidate;
                        await store.commit(candidate);
                        this.data = candidate;
                        this.pendingData = null;
                        value = true;
                        this.savedAt = Date.now();
                        if (session === this) {
                            $('saveStatus').textContent = `Saved ${new Date().toLocaleTimeString()}`;
                            $('saveStatus').classList.remove('error');
                        }
                    } else throw new Error('Unknown storage operation');
                    this.worker?.postMessage({
                        type: 'coop-storage-result',
                        requestId: msg.requestId,
                        value
                    });
                } catch (error) {
                    const text = error.name === 'QuotaExceededError' ? 'Storage is full. Download a backup, then free browser space.' : error.message;
                    if (session === this) {
                        $('saveStatus').textContent = `Save failed: ${text}`;
                        $('saveStatus').classList.add('error');
                        notice(text, true);
                    }
                    this.worker?.postMessage({
                        type: 'coop-storage-result',
                        requestId: msg.requestId,
                        error: text
                    });
                }
            });
        },
        request(type, payload = {}) {
            return new Promise((resolve, reject) => {
                if (!this.worker || !this.ready) {
                    reject(new Error('World is still starting'));
                    return;
                }
                const requestId = crypto.randomUUID();
                const timer = setTimeout(() => {
                    this.requests.delete(requestId);
                    reject(new Error('World request timed out'));
                }, 30000);
                this.requests.set(requestId, {
                    resolve: value => {
                        clearTimeout(timer);
                        resolve(value);
                    },
                    reject: error => {
                        clearTimeout(timer);
                        reject(error);
                    }
                });
                this.worker.postMessage({type, requestId, ...payload});
            });
        }
    };
    window.LoreCoop = session;
    openingState(false);
    try {
        localStorage.setItem('lorescape-last-world-v1', message.worldId);
    } catch {}
    $('lobby').hidden = true;
    document.body.classList.add('playing');
    $('session').hidden = false;
    $('game').hidden = false;
    $('roomCode').textContent = message.code;
    $('hostSettings').hidden = role !== 'host';
    $('guestSettings').hidden = role === 'host';
    $('save').hidden = role !== 'host';
    $('leave').textContent = role === 'host' ? 'Save & end room' : 'Leave room';
    if (session.solo) {
        $('leave').textContent = 'Save & quit';
        $('connection').textContent = 'Solo · local';
    }
    $('copy').hidden = session.solo;
    $('sessionKind').textContent = session.solo ? 'SOLO WORLD' : 'PRIVATE ROOM';
    $('sessionExport').hidden = role !== 'host';
    $('saveStatus').textContent = role === 'host' ? 'Waiting for first checkpoint' : 'Progress saved by the host';
    $('saveStatus').classList.remove('error');
    $('save').disabled = true;
    $('applySettings').disabled = true;
    beginStartup();
    session.autoPlay = message.autoPlay === true;
    const autoCharacter = message.autoPlay ? Object.keys(data.characters)[0] || 'adventurer' : '';
    $('game').src = `index.html?world=${role === 'host' ? 999 : 998}&detail=${preferences.detail}&method=0&coop=1&startup=${encodeURIComponent(session.id)}${autoCharacter ? '&offline=1&character=' + encodeURIComponent(autoCharacter) : ''}`;
    resizeGame();
    notice(role === 'host' ? 'Starting your saved world…' : 'Joining the host…');
}
async function receive(message) {
    if (message.type === 'error') {
        notice(message.message, true);
        openingState(false);
        if (!session) {
            releaseLock?.();
            releaseLock = null;
        }
        return;
    }
    if (message.type === 'created' || message.type === 'joined') {
        try {
            await start(message, message.type === 'created' ? 'host' : 'guest', message.type === 'created' ? window.pendingWorld : null);
        } catch (error) {
            if (socket?.readyState === WebSocket.OPEN) send({type: 'leave'});
            releaseLock?.();
            releaseLock = null;
            openingState(false);
            throw error;
        } finally {
            window.pendingWorld = null;
        }
        return;
    }
    if (message.type === 'ended' || message.type === 'left') {
        if (session) endLocal(message.reason || 'You left the room.');
        return;
    }
    if (!session) return;
    if (message.type === 'roster') {
        session.settings = message.settings;
        $('party').replaceChildren();
        $('slots').textContent = `${message.roster.length} / ${session.solo ? 1 : 4}`;
        for (const player of message.roster) {
            const li = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = `${player.name}${player.host && !session.solo ? ' · host' : ''}`;
            const detail = document.createElement('small');
            detail.textContent = player.state;
            label.append(detail);
            li.append(label);
            if (session.role === 'host' && !player.host) {
                const button = document.createElement('button');
                button.textContent = 'Remove';
                button.onclick = () => send({type: 'kick', to: player.id});
                li.append(button);
            }
            $('party').append(li);
        }
        const encodedSettings = JSON.stringify(message.settings);
        if (session.displayedSettings !== encodedSettings) {
            for (const key of ['xpRate', 'lootRate', 'lootMode']) $(key).value = String(message.settings[key]);
            session.displayedSettings = encodedSettings;
        }
        $('guestSettings').textContent = `XP ×${message.settings.xpRate} · NPC loot ×${message.settings.lootRate} · ${message.settings.lootMode} ownership`;
        return;
    }
    session.signal(message);
}
function endLocal(reason) {
    clearTimeout(session?.startup?.timer);
    $('startupPanel').hidden = true;
    $('gameStage').inert = false;
    $('gameViewport').classList.remove('starting');
    $('gameViewport').setAttribute('aria-busy', 'false');
    exitGameFullscreen().catch(() => {});
    document.body.classList.remove('playing');
    const old = session;
    const previous = socket;
    socket = null;
    previous?.close();
    session = null;
    window.LoreCoop = null;
    openingState(false);
    old?.transport?.dispose();
    old?.worker?.terminate();
    if (old) old.worker = null;
    old?.releaseAssets?.();
    if (old) for (const request of old.requests.values()) request.reject(new Error(reason));
    $('game').src = 'about:blank';
    $('game').hidden = true;
    $('session').hidden = true;
    $('lobby').hidden = false;
    $('connection').textContent = navigator.onLine ? 'Online' : 'Offline';
    const unlock = releaseLock;
    releaseLock = null;
    Promise.resolve(old?.saveQueue).finally(() => {
        unlock?.();
        if (!session && !opening) refreshWorlds(old?.worldId || '').catch(error => notice(error.message, true));
    });
    notice(reason);
}
function action(id, callback) {
    $(id).onclick = async () => {
        $(id).disabled = true;
        try {
            await callback();
        } catch (error) {
            notice(error.message, true);
            if (!session && ['host', 'solo', 'join', 'installOffline'].includes(id)) {
                openingState(false);
                releaseLock?.();
                releaseLock = null;
            }
        } finally {
            $(id).disabled =
                (opening && ['host', 'solo', 'join'].includes(id)) ||
                (['export', 'recover', 'rename', 'delete'].includes(id) && !$('worlds').value) ||
                (['save', 'applySettings'].includes(id) && !session?.ready) ||
                (id === 'persistStorage' && (persistentStorage || !navigator.storage?.persist));
        }
    };
}
async function prepareWorld() {
    if (opening || session) throw new Error('A session is already starting or running');
    openingState(true);
    const id = $('worlds').value;
    let data = id ? null : store.newWorld($('worldName').value);
    await lockWorld(id || data.id);
    const loaded = id ? await store.load(id) : null;
    if (id && !loaded) throw new Error('Saved world no longer exists');
    data = loaded?.data || data;
    await store.commit(data);
    if (loaded?.recovered) notice('Recovered the last valid snapshot. The latest snapshot was damaged.');
    return data;
}
action('host', async () => {
    const data = await prepareWorld();
    window.pendingWorld = data;
    await connect();
    send({type: 'create', worldId: data.id, settings: data.settings});
});
async function playSolo(autoPlay = false) {
    const data = await prepareWorld();
    await start(
        {
            id: crypto.randomUUID(),
            code: 'SOLO',
            worldId: data.id,
            iceServers: [],
            settings: data.settings,
            solo: true,
            autoPlay
        },
        'host',
        data
    );
}
action('solo', () => playSolo());
async function cancelStartup(retry = false) {
    if (!session || $('startupPanel').hidden) return;
    const old = session;
    endLocal('Startup stopped. Your saved world is kept.');
    openingState(true);
    try {
        await old.saveQueue.catch(() => {});
        await refreshWorlds(old.worldId);
    } finally {
        openingState(false);
    }
    if (retry) $('solo').click();
    else $('solo').focus({preventScroll: true});
}
action('cancelStartup', () => cancelStartup());
action('retryStartup', () => cancelStartup(true));
action('join', async () => {
    if (opening || session) throw new Error('A session is already starting or running');
    openingState(true);
    await connect();
    send({type: 'join', code: $('code').value});
});
action('save', async () => {
    await session.request('coop-checkpoint');
    notice('Progress saved.');
});
action('leave', async () => {
    if (session.role === 'host' && session.ready) await session.request('coop-checkpoint');
    send({type: 'leave'});
    endLocal('Session ended. Reopen the saved world whenever you want to play.');
});
action('applySettings', async () => {
    const settings = validateSettings({
        xpRate: Number($('xpRate').value),
        lootRate: Number($('lootRate').value),
        lootMode: $('lootMode').value
    });
    await session.request('coop-settings', {settings});
    send({type: 'settings', settings});
    notice('Settings applied and saved.');
});
action('copy', async () => {
    await navigator.clipboard.writeText(session.code);
    notice('Room code copied. Share it privately with your friends.');
});
action('export', async () => {
    if (!$('worlds').value) throw new Error('Select a saved world to export');
    downloadBackup(await store.export($('worlds').value));
    notice('Backup download started. Keep this file somewhere safe.');
});
function downloadBackup(text) {
    const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    const data = JSON.parse(text);
    const name = String(data.snapshot?.data?.name || 'world').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48);
    link.download = `lorescape-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
action('sessionExport', async () => {
    const current = session;
    try {
        await current.request('coop-checkpoint');
        downloadBackup(await store.export(current.worldId));
        notice('Current progress backed up.');
    } catch (error) {
        if (!current.pendingData) throw error;
        downloadBackup(await store.exportData(current.pendingData));
        notice('Backup downloaded from unsaved progress. Browser saving still needs attention.', true);
    }
});
action('recover', async () => {
    if (!$('worlds').value) throw new Error('Select a saved world to recover');
    const id = $('worlds').value;
    await lockWorld(id);
    try {
        await store.recover(id);
        await worldInfo();
    } finally {
        releaseLock?.();
        releaseLock = null;
    }
    notice('Earlier valid snapshot restored.');
});
action('rename', async () => {
    const id = $('worlds').value;
    if (!id) throw new Error('Select a saved world');
    await lockWorld(id);
    try {
        await store.rename(id, $('worldName').value);
        await refreshWorlds(id);
    } finally {
        releaseLock?.();
        releaseLock = null;
    }
    notice('World renamed.');
});
action('delete', async () => {
    const loaded = await store.load($('worlds').value);
    if (!loaded) throw new Error('Select a saved world');
    deleteTarget = loaded.data;
    $('deleteName').value = '';
    $('deleteDescription').textContent = `This removes ${deleteTarget.name}, all its characters and all recovery snapshots. Export a backup first.`;
    $('deleteDialog').showModal();
});
$('deleteCancel').onclick = () => {
    deleteTarget = null;
    $('deleteDialog').close();
};
action('deleteConfirm', async () => {
    if (!deleteTarget || $('deleteName').value !== deleteTarget.name) throw new Error('Type the exact world name to delete it');
    await lockWorld(deleteTarget.id);
    try {
        await store.remove(deleteTarget.id);
    } finally {
        releaseLock?.();
        releaseLock = null;
    }
    deleteTarget = null;
    $('deleteDialog').close();
    await refreshWorlds();
    await storageInfo();
    notice('Saved world deleted.');
});
$('importFile').onchange = async () => {
    try {
        const file = $('importFile').files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw new Error('Backup is too large');
        importText = await file.text();
        const data = await store.inspect(importText);
        $('importDescription').textContent = `${data.name}: ${Object.keys(data.characters).length} characters. Import as a new world, or choose to replace the matching saved world.`;
        $('importPreview').hidden = false;
    } catch (error) {
        importText = null;
        $('importPreview').hidden = true;
        notice(error.message, true);
    }
};
action('importConfirm', async () => {
    if (session || !importText) throw new Error('End your session before importing');
    const preview = await store.inspect(importText);
    await lockWorld(preview.id);
    try {
        const data = await store.import(importText, $('replace').checked);
        await refreshWorlds(data.id);
    } finally {
        releaseLock?.();
        releaseLock = null;
    }
    $('importPreview').hidden = true;
    importText = null;
    notice('Backup imported and validated.');
});
window.addEventListener('beforeunload', () => {
    socket?.close();
    releaseLock?.();
});
function showPreferences() {
    for (const key of ['detail', 'fps', 'scale']) $(key).value = String(preferences[key]);
    $('mute').checked = preferences.mute;
}
function applyDevice(value) {
    preferences = savePreferences(value);
    if (session) {
        session.preferences = preferences;
        $('game').contentWindow.postMessage({type: 'coop-device', preferences}, location.origin);
    }
    showPreferences();
    resizeGame();
}
action('deviceSave', async () => {
    applyDevice({
        detail: $('detail').value,
        fps: Number($('fps').value),
        scale: $('scale').value,
        mute: $('mute').checked
    });
    notice('Device settings saved. Graphics detail applies next session.');
});
action('batteryPreset', async () => {
    applyDevice({detail: 'low', fps: 15, scale: 'fit', mute: true});
    notice('Battery saver enabled. Low detail applies next session.');
});
function resizeGame() {
    const viewport = $('gameViewport');
    const width = viewport.clientWidth;
    const expanded = gameExpanded();
    $('fullscreenHint').textContent = expanded && width < 600 ? 'Rotate to landscape for a larger view' : 'Escape to return · Ctrl/Cmd+S to save';
    const scale = expanded ? Math.min(Math.max(1, width - 24) / 789, Math.max(1, viewport.clientHeight - 128) / 532) : preferences.scale === 'fit' ? Math.min(1.5, (width || 789) / 789) : preferences.scale === 'large' ? 1.25 : 1;
    $('game').style.transform = `scale(${scale})`;
    $('gameStage').style.width = `${789 * scale}px`;
    $('gameStage').style.height = `${532 * scale}px`;
}
new ResizeObserver(resizeGame).observe($('gameViewport'));
function gameExpanded() {
    return document.fullscreenElement === $('gameViewport') || document.body.classList.contains('screen-mode');
}
function updateFullscreen() {
    const expanded = gameExpanded();
    document.documentElement.classList.toggle('game-expanded', expanded);
    $('fullscreen').textContent = expanded ? 'Exit fullscreen' : 'Enter fullscreen';
    $('fullscreen').setAttribute('aria-pressed', String(expanded));
    resizeGame();
}
async function exitGameFullscreen() {
    fullscreenRequest++;
    document.body.classList.remove('screen-mode');
    if (document.fullscreenElement === $('gameViewport')) await document.exitFullscreen();
    updateFullscreen();
    if (session) $('fullscreen').focus({preventScroll: true});
}
action('fullscreen', async () => {
    if (!session) return;
    if (gameExpanded()) await exitGameFullscreen();
    else {
        const current = session, request = ++fullscreenRequest;
        try {
            if (!document.fullscreenEnabled || !$('gameViewport').requestFullscreen) throw new Error('Native fullscreen unavailable');
            await $('gameViewport').requestFullscreen();
            if (session !== current || request !== fullscreenRequest) {
                if (document.fullscreenElement === $('gameViewport')) await document.exitFullscreen();
                updateFullscreen();
                return;
            }
        } catch {
            if (session !== current || request !== fullscreenRequest) return;
            document.body.classList.add('screen-mode');
            notice('Screen-filling mode enabled. Press Escape or Exit fullscreen to return.');
        }
        updateFullscreen();
        try {
            if (!$('gameStage').inert) $('game').contentWindow.document.querySelector('canvas')?.focus();
        } catch {}
    }
});
action('exitFullscreen', exitGameFullscreen);
document.addEventListener('fullscreenchange', () => {
    updateFullscreen();
    if (!gameExpanded() && session) $('fullscreen').focus({preventScroll: true});
});
function escapeScreenMode(event) {
    if (event.key === 'Escape' && document.body.classList.contains('screen-mode')) {
        event.preventDefault();
        exitGameFullscreen().catch(error => notice(error.message, true));
    }
}
document.addEventListener('keydown', escapeScreenMode);
$('game').addEventListener('load', () => {
    try {
        $('game').contentWindow.document.addEventListener('keydown', escapeScreenMode);
    } catch {}
});
document.addEventListener('keydown', event => {
    if (session?.role === 'host' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        $('save').click();
    }
});
window.addEventListener('message', event => {
    if (event.source === $('game').contentWindow && event.origin === location.origin && session?.startup && !session.startup.failed && !$('startupPanel').hidden && event.data?.startupId === session.id) {
        if (event.data.type === 'coop-client-progress' && Number.isFinite(event.data.progress)) {
            session.startup.progress = Math.max(session.startup.progress, Math.min(100, Math.max(0, event.data.progress)));
            $('startupMessage').textContent = String(event.data.message || 'Loading game client…').slice(0, 200);
            updateStartup();
        } else if (event.data.type === 'coop-client-ready') {
            session.startup.client = true;
            $('startupMessage').textContent = 'Starting your world simulation…';
            updateStartup();
        } else if (event.data.type === 'coop-client-error') startupFailure(String(event.data.message || 'Game client could not load.').slice(0, 200));
    }
    if (event.source === $('game').contentWindow && event.origin === location.origin && event.data?.type === 'coop-save-shortcut' && session?.role === 'host') $('save').click();
});
document.addEventListener('visibilitychange', () => {
    if (!session) return;
    $('game').contentWindow.postMessage(
        {
            type: 'coop-device',
            preferences: {
                ...preferences,
                fps: document.hidden ? 15 : preferences.fps
            }
        },
        location.origin
    );
    if (document.hidden && session.ready && session.role === 'host') session.request('coop-checkpoint').catch(error => notice(error.message, true));
});
window.addEventListener('online', () => {
    if (!session) $('connection').textContent = 'Online';
});
window.addEventListener('offline', () => {
    if (!session) $('connection').textContent = 'Offline · solo available';
});
async function storageInfo() {
    const estimate = await navigator.storage?.estimate?.();
    const persistent = (persistentStorage = !!(await navigator.storage?.persisted?.()));
    $('storageInfo').textContent = estimate
        ? `${(estimate.usage / 1048576).toFixed(1)} MiB used of ${(estimate.quota / 1048576).toFixed(0)} MiB · ${persistent ? 'persistent storage granted' : 'best-effort storage'}`
        : 'Storage estimates are unavailable in this browser.';
    $('persistStorage').disabled = persistent || !navigator.storage?.persist;
}
let canCancelOffline = true;
let offlineReady = false;
function offlineMessage(text) {
    $('offlineStatus').textContent = text;
    $('installOfflineStatus').textContent = text;
}
function offlineStatus(status) {
    canCancelOffline = status.supportsCancellation === true;
    offlineReady = status.ready === true;
    $('installOffline').textContent = offlineReady ? 'Play offline' : 'Install cache & play offline';
    offlineMessage(status.ready ? `Offline ready · ${(status.bytes / 1048576).toFixed(1)} MiB · solo play works without the server.` : 'Game files are not downloaded yet. Connect once, then download for offline solo play.');
}
action('persistStorage', async () => {
    const granted = await navigator.storage.persist();
    await storageInfo();
    notice(granted ? 'Persistent browser storage granted. Keep exported backups too.' : 'The browser did not grant persistence. Saves still work; keep exported backups.');
});
let downloadController = null;
$('cancelInstall').onclick = $('cancelOffline').onclick = () => {
    downloadController?.abort();
    $('cancelOffline').disabled = true;
    $('cancelInstall').disabled = true;
    offlineMessage('Cancelling download…');
};
async function downloadOffline() {
    if (session || opening) throw new Error('End your session before updating offline files');
    if (downloadController) throw new Error('An offline download is already running');
    downloadController = new AbortController();
    for (const id of ['solo', 'host', 'join', 'installOffline']) $(id).disabled = true;
    $('offlineProgress').hidden = false;
    $('installProgress').hidden = false;
    $('installProgress').value = 0;
    $('offlineProgress').value = 0;
    $('cancelOffline').hidden = !canCancelOffline;
    $('cancelInstall').hidden = !canCancelOffline;
    $('cancelInstall').disabled = false;
    $('cancelOffline').disabled = false;
    $('removeOffline').disabled = true;
    offlineMessage('Preparing offline download…');
    try {
        offlineStatus(
            await offlineAction('offline-prepare', progress => {
                $('offlineProgress').value = (progress.done / progress.total) * 100;
                $('installProgress').value = $('offlineProgress').value;
                offlineMessage(`Downloading ${Math.floor(progress.done / progress.total * 100)}% · ${progress.done} / ${progress.total} files · ${(progress.bytes / 1048576).toFixed(1)}${progress.totalBytes ? ' / ' + (progress.totalBytes / 1048576).toFixed(1) : ''} MiB`);
            }, downloadController.signal)
        );
        notice('Offline game ready. You can return here without a connection.');
        await storageInfo();
        return true;
    } catch (error) {
        try { offlineStatus(await offlineAction('offline-status')); } catch {}
        if (downloadController.signal.aborted) notice('Download cancelled. Existing offline files and character saves are kept.');
        else throw error;
    } finally {
        downloadController = null;
        $('cancelOffline').hidden = true;
        $('cancelInstall').hidden = true;
        $('removeOffline').disabled = false;
        $('offlineProgress').hidden = true;
        $('installProgress').hidden = true;
        for (const id of ['solo', 'host', 'join', 'installOffline']) $(id).disabled = false;
    }
}
action('downloadOffline', downloadOffline);
action('installOffline', async () => {
    await worldsReady;
    if (session || opening) throw new Error('Return to the launcher before starting another adventure');
    if (!offlineReady && !(await downloadOffline())) return;
    await playSolo(true);
});
action('removeOffline', async () => {
    if (session || opening) throw new Error('End your session before removing offline files');
    offlineStatus(await offlineAction('offline-remove'));
    await storageInfo();
    notice('Offline game download removed. Character saves remain.');
});
$('worlds').onchange = () => worldInfo().catch(error => notice(error.message, true));
showPreferences();
$('connection').textContent = navigator.onLine ? 'Online' : 'Offline · solo available';
storageInfo().catch(error => notice(error.message, true));
offlineAction('offline-status')
    .then(offlineStatus)
    .catch(error => {
        offlineMessage(error.message);
    });
const invite = new URLSearchParams(location.search).get('room');
if (invite) $('code').value = invite;
let lastWorld = '';
try {
    lastWorld = localStorage.getItem('lorescape-last-world-v1') || '';
} catch {}
const worldsReady = refreshWorlds(lastWorld);
worldsReady.catch(error => notice(error.message, true));
if (new URLSearchParams(location.search).get('install') === '1') {
    const url = new URL(location.href);
    url.searchParams.delete('install');
    history.replaceState(null, '', url);
    $('installOffline').click();
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    $('installApp').hidden = false;
});
action('installApp', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('installApp').hidden = true;
});
window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('installApp').hidden = true;
});
