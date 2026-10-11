/* Only application assets are cached here. Character saves remain in IndexedDB. */
const PREFIX = 'lorescape-assets-v1-';
const META = 'lorescape-offline-meta-v1';
const POINTER = '/_lorescape/offline-active';
let installing = false;
let activeManifest;
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
async function active() {
    if (activeManifest !== undefined) return activeManifest;
    const response = await (await caches.open(META)).match(POINTER);
    activeManifest = response ? await response.json() : null;
    return activeManifest;
}
async function status() {
    const manifest = await active();
    if (!manifest || !(await caches.has(PREFIX + manifest.revision))) return {ready: false};
    const cache = await caches.open(PREFIX + manifest.revision);
    const urls = new Set((await cache.keys()).map(request => request.url));
    if (manifest.assets.some(asset => !urls.has(new URL(asset.url, self.location.origin).href))) return {ready: false};
    return {ready: true, revision: manifest.revision, bytes: manifest.bytes, files: manifest.assets.length};
}
async function prepare(progress) {
    if (installing) throw new Error('An offline download is already running');
    installing = true;
    let staging, previous;
    try {
        const response = await fetch('/offline-assets.json', {cache: 'no-store'});
        if (!response.ok) throw new Error('Offline pack is unavailable. Finish setup and builds first.');
        const manifest = await response.json();
        if (
            manifest.version !== 1 ||
            !/^[a-f0-9]{20}$/.test(manifest.revision) ||
            !Array.isArray(manifest.assets) ||
            !manifest.assets.length ||
            manifest.assets.some(
                asset =>
                    !/^\/(?:coop\/|data\/pack\/(?:client|server)\/|data\/config\/private\.pem$|[a-zA-Z0-9_.-]+$)/.test(asset.url) ||
                    asset.url.includes('..') ||
                    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
                    !Number.isSafeInteger(asset.bytes) ||
                    asset.bytes < 0
            )
        )
            throw new Error('Invalid offline manifest');
        previous = await active();
        if (previous?.revision === manifest.revision && (await status()).ready) return status();
        staging = PREFIX + manifest.revision;
        await caches.delete(staging);
        const cache = await caches.open(staging);
        let downloaded = 0,
            next = 0,
            done = 0,
            failure = null;
        const controller = new AbortController();
        // Bound memory and network concurrency for modest Chromebook hardware.
        await Promise.all(
            Array.from({length: 4}, async () => {
                while (!failure && next < manifest.assets.length) {
                    const asset = manifest.assets[next++];
                    try {
                        const result = await fetch(asset.url, {cache: 'no-store', signal: controller.signal});
                        if (!result.ok) throw new Error('Could not download ' + asset.url);
                        const bytes = await result.clone().arrayBuffer();
                        if (bytes.byteLength !== asset.bytes || (await hash(bytes)) !== asset.sha256) throw new Error('Game files changed during download. Rebuild, then try again.');
                        await cache.put(asset.url, result);
                        downloaded += asset.bytes;
                        progress({done: ++done, total: manifest.assets.length, bytes: downloaded});
                    } catch (error) {
                        failure ||= error;
                        controller.abort();
                    }
                }
            })
        );
        if (failure) throw failure;
        await (await caches.open(META)).put(POINTER, new Response(JSON.stringify(manifest), {headers: {'Content-Type': 'application/json'}}));
        activeManifest = manifest;
        for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== staging) await caches.delete(name);
        return status();
    } catch (error) {
        if (staging && staging !== PREFIX + previous?.revision) await caches.delete(staging);
        throw error;
    } finally {
        installing = false;
    }
}
self.addEventListener('message', event => {
    const port = event.ports[0];
    if (!port) return;
    event.waitUntil(
        (async () => {
            try {
                let result;
                if (event.data?.type === 'offline-status') result = await status();
                else if (['offline-prepare', 'offline-remove'].includes(event.data?.type)) {
                    const change = async () => {
                        if (installing) throw new Error('Wait for the offline operation to finish');
                        if (event.data.type === 'offline-prepare') return prepare(progress => port.postMessage({progress}));
                        installing = true;
                        try {
                            for (const name of await caches.keys()) if (name === META || name.startsWith(PREFIX)) await caches.delete(name);
                            activeManifest = null;
                            return {ready: false};
                        } finally {
                            installing = false;
                        }
                    };
                    result = self.navigator.locks
                        ? await self.navigator.locks.request('lorescape-offline-assets', {ifAvailable: true}, lock => {
                              if (!lock) throw new Error('End sessions in all LoreScape tabs and wait for any offline operation to finish');
                              return change();
                          })
                        : await change();
                } else throw new Error('Unknown offline action');
                port.postMessage({result});
            } catch (error) {
                port.postMessage({error: error.name === 'QuotaExceededError' ? 'Not enough browser storage. Export your saves and free some space.' : error.message});
            }
        })()
    );
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/signal' || url.pathname === '/offline-assets.json' || url.pathname === '/offline-sw.js') return;
    event.respondWith(
        (async () => {
            try {
                return await fetch(event.request);
            } catch {
                const manifest = await active();
                if (manifest) {
                    const key = url.pathname === '/' ? (url.searchParams.has('world') ? '/index.html' : '/coop.html') : ['/coop', '/coop/'].includes(url.pathname) ? '/coop.html' : url.pathname;
                    const cached = await (await caches.open(PREFIX + manifest.revision)).match(key);
                    if (cached) return cached;
                }
                return new Response('This file is unavailable offline. Download the offline game pack from the lobby while connected.', {status: 503, headers: {'Content-Type': 'text/plain'}});
            }
        })()
    );
});
