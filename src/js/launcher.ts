import '../style/launcher.scss';
import {setPageStatus, showStartupError} from './page-shell';
import {downloadText} from './jagex2/util/JsUtil';
import {defaultPreferences, LauncherPreferences, parsePreferences, parseWorldChoices, validWorld} from './launcher-state';
import type {WorldInfo} from './worldlist';
import {DEFAULT_LOCAL_ADDRESS, localWorldAddresses, WORLD_LIST_URL} from './connection';
import {checkWorkerBundle, isLocalWorld, loadClientChecksums, worldLabel} from './local-worlds';

const storageKey: string = 'lorescape.launcher.v1';
const form: HTMLFormElement = document.getElementById('launcher-form') as HTMLFormElement;
const worldInput: HTMLInputElement = document.getElementById('world') as HTMLInputElement;
const localAddress: HTMLInputElement = document.getElementById('local-address') as HTMLInputElement;
const list: HTMLElement = document.getElementById('world-list')!;
const filter: HTMLSelectElement = document.getElementById('world-filter') as HTMLSelectElement;
const refresh: HTMLButtonElement = document.getElementById('refresh-worlds') as HTMLButtonElement;
const launchButton: HTMLButtonElement = document.getElementById('launch-button') as HTMLButtonElement;
const connectionStatus: HTMLElement = document.querySelector('.lore-status')!;
const stage: HTMLElement = document.getElementById('client-stage')!;
const parameters: URLSearchParams = new URLSearchParams(window.location.search);
let preferences: LauncherPreferences = {...defaultPreferences};
let worlds: WorldInfo[] = [];
let started: boolean = false;
let pendingCheck: AbortController | undefined;
let cacheDownload: AbortController | undefined;
const downloadCacheButton: HTMLButtonElement = document.getElementById('download-cache') as HTMLButtonElement;
const cancelDownloadButton: HTMLButtonElement = document.getElementById('cancel-cache-download') as HTMLButtonElement;
const downloadStatus: HTMLElement = document.getElementById('cache-download-status')!;
const cancelCheckButton: HTMLButtonElement = document.getElementById('cancel-check') as HTMLButtonElement;

try {
    preferences = parsePreferences(localStorage.getItem(storageKey));
} catch {
    document.querySelector('.launch-saved')!.textContent = 'Your settings apply to this visit. Saved preferences are unavailable in this browser.';
}
const linkedWorld: string | null = parameters.get('world');
if (linkedWorld !== null && linkedWorld.trim() && validWorld(Number(linkedWorld))) preferences.world = Number(linkedWorld);
if (['high', 'low'].includes(parameters.get('detail') || '')) preferences.detail = parameters.get('detail') as 'high' | 'low';
localAddress.value = parameters.get('local') || preferences.localAddress || DEFAULT_LOCAL_ADDRESS;
worldInput.value = String(preferences.world);
(document.querySelector(`input[name="detail"][value="${preferences.detail}"]`) as HTMLInputElement).checked = true;
document.getElementById('selected-world')!.textContent = String(preferences.world);
updateLocalControls();
document.getElementById('launch-status')!.append(connectionStatus);
setPageStatus('Choose your world, then enter the adventure.');

function remember(): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
        document.querySelector('.launch-saved')!.textContent = 'Your settings apply to this visit. Saved preferences are unavailable in this browser.';
    }
}

function updateLocalControls(): void {
    const id: number = preferences.world;
    localAddress.disabled = id !== 0;
    localAddress.required = id === 0;
    document.getElementById('local-server-settings')!.hidden = id !== 0;
    const help: HTMLElement = document.getElementById('local-mode-help')!;
    help.hidden = id !== 998 && id !== 999;
    help.textContent =
        id === 999
            ? 'Requires worker.js, its server dependencies, and data/pack/client/ beside this page. A normal build does not include them. Select New user on the login screen to exchange a peer invitation, or type ::peer while logged in.'
            : 'Requires matching data/pack/client/ on this website and a running browser host. Select New user on the login screen to paste the host invitation before logging in.';
    for (const button of document.querySelectorAll<HTMLButtonElement>('.local-world-option')) button.setAttribute('aria-pressed', String(Number(button.dataset.world) === id));
    if (isLocalWorld(id)) (document.getElementById('local-worlds') as HTMLDetailsElement).open = true;
    document.querySelector<HTMLElement>('.launch-account')!.hidden = isLocalWorld(id);
}

function cancelCheck(): void {
    if (!pendingCheck) return;
    pendingCheck.abort();
    pendingCheck = undefined;
    launchButton.disabled = false;
    cancelCheckButton.hidden = true;
    form.removeAttribute('aria-busy');
    document.body.classList.remove('is-checking');
    const url: URL = new URL(window.location.href);
    url.searchParams.delete('world');
    url.searchParams.delete('local');
    window.history.replaceState(null, '', url);
    setPageStatus('Connection check cancelled. Choose a world and enter when you are ready.');
}

function chooseWorld(id: number): void {
    cancelCheck();
    cancelCacheDownload();
    preferences.world = id;
    worldInput.value = String(id);
    document.getElementById('selected-world')!.textContent = String(id);
    for (const button of list.querySelectorAll<HTMLButtonElement>('.world-option')) button.setAttribute('aria-pressed', String(Number(button.dataset.world) === id));
    updateLocalControls();
    setPageStatus(`${worldLabel(id)} selected. Enter the world when you are ready.`);
    remember();
}

function renderWorlds(): void {
    const visible: WorldInfo[] = worlds.filter((world: WorldInfo): boolean => filter.value === 'all' || (filter.value === 'members' ? world.members === true : world.members !== true));
    list.replaceChildren();
    document.getElementById('world-count')!.textContent = `${visible.length} listed ${visible.length === 1 ? 'world' : 'worlds'}`;
    if (!visible.length) {
        const empty: HTMLParagraphElement = document.createElement('p');
        empty.className = 'world-placeholder';
        empty.textContent = worlds.length ? 'No worlds match this filter. Try another world type.' : 'Enter a world ID below, or refresh the directory.';
        list.append(empty);
        return;
    }
    for (const world of visible) {
        const button: HTMLButtonElement = document.createElement('button');
        button.type = 'button';
        button.className = 'world-option';
        button.dataset.world = String(world.id);
        button.setAttribute('aria-pressed', String(preferences.world === world.id));
        button.innerHTML = '<span class="world-radio" aria-hidden="true"></span><span><span class="world-name"></span><span class="world-region"></span></span><span class="world-meta"><span></span><small></small></span>';
        button.querySelector('.world-name')!.textContent = `World ${world.id}`;
        button.querySelector('.world-region')!.textContent = world.region;
        button.querySelector('.world-meta > span')!.textContent = `${world.players.toLocaleString()} players`;
        button.querySelector('small')!.textContent = world.members === true ? 'MEMBERS' : 'FREE TO PLAY';
        button.addEventListener('click', (): void => chooseWorld(world.id));
        list.append(button);
    }
}

async function refreshWorlds(): Promise<void> {
    refresh.disabled = true;
    list.setAttribute('aria-busy', 'true');
    const notice: HTMLElement = document.getElementById('world-notice')!;
    notice.hidden = true;
    document.getElementById('world-count')!.textContent = 'Fetching worlds…';
    try {
        worlds = parseWorldChoices(JSON.parse(await downloadText(WORLD_LIST_URL, 10000)));
        if (!worlds.length) throw new Error('No worlds returned.');
    } catch {
        notice.textContent = worlds.length ? 'The directory could not be refreshed. Showing the last fetched list.' : 'World directory unavailable. Refresh to retry, or connect by world ID below.';
        notice.hidden = false;
        if (!worlds.length) (document.getElementById('world-manual') as HTMLDetailsElement).open = true;
    } finally {
        renderWorlds();
        refresh.disabled = false;
        list.setAttribute('aria-busy', 'false');
    }
}

async function launch(): Promise<void> {
    cancelCacheDownload();
    if (pendingCheck) return;
    if (!form.reportValidity()) return;
    const id: number = Number(worldInput.value);
    if (!validWorld(id)) return;
    preferences.world = id;
    preferences.detail = (form.elements.namedItem('detail') as RadioNodeList).value === 'low' ? 'low' : 'high';
    if (id === 0) preferences.localAddress = localAddress.value;
    remember();
    const selectedDetail: 'high' | 'low' = preferences.detail;
    const selectedAddress: string = localAddress.value;
    const url: URL = new URL(window.location.href);
    url.searchParams.set('world', String(id));
    url.searchParams.set('detail', preferences.detail);
    if (id === 0) url.searchParams.set('local', localAddress.value);
    else url.searchParams.delete('local');
    if (!url.searchParams.has('method')) url.searchParams.set('method', '0');
    if (started) {
        window.location.assign(url.href);
        return;
    }
    if (isLocalWorld(id)) {
        const check: AbortController = new AbortController();
        pendingCheck = check;
        cancelCheckButton.hidden = false;
        form.setAttribute('aria-busy', 'true');
        launchButton.disabled = true;
        setPageStatus('Checking local world files…');
        document.body.classList.add('is-checking');
        try {
            const files: string = id === 0 ? localWorldAddresses(selectedAddress, window.location.protocol === 'https:').files : 'data/pack/client';
            window.history.replaceState(null, '', url);
            if (id >= 998 && typeof RTCPeerConnection === 'undefined') throw new Error('Browser worlds require WebRTC support. Use a current browser or choose Local server.');
            if (id === 999) await checkWorkerBundle(check.signal);
            await loadClientChecksums(files, id, check.signal);
            if (check.signal.aborted) return;
        } catch (error) {
            if (check.signal.aborted) return;
            showStartupError(error);
            launchButton.disabled = false;
            return;
        } finally {
            if (pendingCheck === check) {
                pendingCheck = undefined;
                cancelCheckButton.hidden = true;
                form.removeAttribute('aria-busy');
                document.body.classList.remove('is-checking');
            }
        }
    }
    started = true;
    window.history.replaceState(null, '', url);
    launchButton.disabled = true;
    stage.hidden = false;
    document.body.classList.add('has-client');
    document.getElementById('client-heading')!.textContent = worldLabel(id);
    document.getElementById('client-detail')!.textContent = selectedDetail === 'low' ? 'Low detail · Classic client' : 'High detail · Classic client';
    document.getElementById('client-status')!.append(connectionStatus);
    setPageStatus('Loading the client…');
    stage.scrollIntoView({block: 'start'});
    (document.getElementById('canvas') as HTMLCanvasElement).focus({preventScroll: true});
    try {
        await import(/* webpackChunkName: "game-client" */ './game');
    } catch (error) {
        console.error(error);
        showStartupError(error);
    }
}

form.addEventListener('submit', (event: SubmitEvent): void => {
    event.preventDefault();
    void launch();
});
worldInput.addEventListener('input', (): void => {
    cancelCheck();
    cancelCacheDownload();
    const id: number = Number(worldInput.value);
    if (worldInput.value && validWorld(id)) chooseWorld(id);
});
cancelCheckButton.addEventListener('click', (): void => {
    cancelCheck();
    launchButton.focus();
});
form.addEventListener('change', (): void => {
    cancelCheck();
    cancelCacheDownload();
    preferences.detail = (form.elements.namedItem('detail') as RadioNodeList).value === 'low' ? 'low' : 'high';
    remember();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('.local-world-option')) {
    button.addEventListener('click', (): void => chooseWorld(Number(button.dataset.world)));
}
localAddress.addEventListener('input', (): void => {
    cancelCheck();
    cancelCacheDownload();
    preferences.localAddress = localAddress.value;
    setPageStatus('Server address updated. Enter world 0 to check this server.');
    remember();
});
filter.addEventListener('change', renderWorlds);
refresh.addEventListener('click', (): void => {
    void refreshWorlds();
});

window.addEventListener('lore:status', (event: Event): void => {
    document.getElementById('official-play')!.hidden = !(event as CustomEvent<{failed: boolean}>).detail.failed || isLocalWorld(preferences.world);
});

const fullscreen: HTMLButtonElement = document.getElementById('fullscreen-client') as HTMLButtonElement;
fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.addEventListener('click', (): void => {
    const canvas: HTMLCanvasElement = document.getElementById('canvas') as HTMLCanvasElement;
    void canvas.requestFullscreen().catch((): void => {
        fullscreen.disabled = true;
        fullscreen.textContent = 'Fullscreen unavailable';
    });
});

if (linkedWorld !== null && linkedWorld.trim() && validWorld(Number(linkedWorld))) void launch();
else {
    if (linkedWorld !== null) setPageStatus('That world ID is invalid. Choose a listed world or enter an ID from 0 to 999.', true);
    if (!isLocalWorld(preferences.world)) void refreshWorlds();
    else {
        list.setAttribute('aria-busy', 'false');
        document.getElementById('world-count')!.textContent = 'Local world selected';
        list.textContent = 'Select Refresh to browse public worlds.';
    }
}

function cancelCacheDownload(): void {
    if (!cacheDownload) return;
    cacheDownload.abort();
    cacheDownload = undefined;
    downloadCacheButton.disabled = false;
    downloadCacheButton.removeAttribute('aria-busy');
    cancelDownloadButton.hidden = true;
    downloadStatus.textContent = 'Download cancelled. No ZIP was saved.';
}

downloadCacheButton.addEventListener('click', (): void => {
    void exportCache();
});
cancelDownloadButton.addEventListener('click', (): void => {
    cancelCacheDownload();
    downloadCacheButton.focus();
});

async function exportCache(): Promise<void> {
    if (cacheDownload || !form.reportValidity()) return;
    cancelCheck();
    const world: number = Number(worldInput.value);
    if (!validWorld(world)) return;
    const address: string = localAddress.value;
    const controller: AbortController = new AbortController();
    cacheDownload = controller;
    downloadCacheButton.disabled = true;
    downloadCacheButton.setAttribute('aria-busy', 'true');
    cancelDownloadButton.hidden = false;
    downloadStatus.textContent = `Finding the cache for ${worldLabel(world)}…`;
    try {
        const downloader: typeof import('./cache-download') = await import(/* webpackChunkName: "cache-download" */ './cache-download');
        controller.signal.throwIfAborted();
        const source: import('./cache-download').CacheSource = await downloader.resolveCacheSource(world, address, window.location.protocol === 'https:', controller.signal);
        const blob: Blob = await downloader.downloadServerCache(source, controller.signal, (message: string): void => {
            if (!controller.signal.aborted) downloadStatus.textContent = message;
        });
        controller.signal.throwIfAborted();
        downloader.saveCacheZip(blob, world);
        downloadStatus.textContent = `World ${world} core cache ZIP sent to your browser (${(blob.size / 1024 / 1024).toFixed(1)} MB). Save it if prompted, then open Files → Downloads. This does not enable offline play.`;
    } catch (error) {
        if (!controller.signal.aborted) downloadStatus.textContent = `Cache download failed. ${error instanceof Error ? error.message : 'Check the selected server and try again.'} No ZIP was saved.`;
    } finally {
        if (cacheDownload === controller) {
            cacheDownload = undefined;
            downloadCacheButton.disabled = false;
            downloadCacheButton.removeAttribute('aria-busy');
            cancelDownloadButton.hidden = true;
            if (document.activeElement === document.body) downloadCacheButton.focus();
        }
    }
}
