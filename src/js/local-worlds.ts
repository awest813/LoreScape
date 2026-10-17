import {downloadText, downloadUrl} from './jagex2/util/JsUtil';

export function isLocalWorld(world: number): boolean {
    return world === 0 || world === 998 || world === 999;
}

export function worldLabel(world: number): string {
    return world === 0 ? 'Local server' : world === 998 ? 'Join a host' : world === 999 ? 'Host in browser' : `World ${world}`;
}

export async function usesRoomLobby(signal: AbortSignal): Promise<boolean> {
    try {
        const bundle: unknown = JSON.parse(await downloadText('browser-world.json', 3000, signal));
        return !!bundle && typeof bundle === 'object' && (bundle as {version?: unknown}).version === 1 && (bundle as {kind?: unknown}).kind === 'lorescape-coop';
    } catch (error) {
        if (signal.aborted) throw error;
        return false;
    }
}

export async function loadClientChecksums(address: string, world: number, signal?: AbortSignal): Promise<Int8Array> {
    const endpoint: string = `${address}/crc`;
    try {
        const bytes: Int8Array = await downloadUrl(endpoint, 10000, signal);
        if (bytes.length !== 36) throw new Error(`Expected a 36-byte CRC table; received ${bytes.length} bytes. Check that this URL serves game data, not an HTML page.`);
        return bytes;
    } catch (error) {
        const guidance: string =
            world === 0
                ? 'Start the local game server, check its web port, and allow this launcher origin in its CORS settings.'
                : isLocalWorld(world)
                  ? 'Install the matching client game data under data/pack/client/ on this website. Peer and worker bundles are separate downloads.'
                  : 'The selected world must provide compatible game files and allow this launcher origin (CORS). Try another world if it is offline.';
        throw new Error(`Cannot load game files from ${endpoint}. ${error instanceof Error ? error.message : ''} ${guidance}`);
    }
}

export async function checkWorkerBundle(signal?: AbortSignal): Promise<void> {
    const controller: AbortController = new AbortController();
    const cancel = (): void => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) cancel();
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => controller.abort(), 10000);
    try {
        const response: Response = await fetch('worker.js', {signal: controller.signal});
        await response.body?.cancel();
        if (!response.ok || !/(?:javascript|ecmascript)/i.test(response.headers.get('content-type') || '')) throw new Error('Missing worker module.');
    } catch {
        throw new Error(
            'Host in browser requires worker.js and its matching server dependencies beside index.html. These bundles are not included in the GitHub Pages build. Use Local server for a separately running server, or install a compatible worker bundle.'
        );
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}
