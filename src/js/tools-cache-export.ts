import {ClassicCacheWriter} from './classic-cache';
import {encodeModel317} from './model-export';
import Model from './jagex2/graphics/Model';
import Jagfile from './jagex2/io/Jagfile';
import Bzip from './vendor/bzip';
import {downloadUrl} from './jagex2/util/JsUtil';
import {createCacheZip} from './cache-zip';
import type {ZipFile} from './cache-zip';

export async function buildToolsCache(archives: Uint8Array[], signal: AbortSignal, progress: (message: string) => void): Promise<ZipFile[]> {
    signal.throwIfAborted();
    if (archives.length !== 8) throw new Error('All eight verified client archives are required.');
    const cache: ClassicCacheWriter = new ClassicCacheWriter();
    for (let index: number = 0; index < archives.length; index++) cache.add(0, index + 1, archives[index]);
    const models: Jagfile = new Jagfile(archives[4]);
    const head: Uint8Array | null = models.read('ob_head.dat');
    if (!head || head.length < 2) throw new Error('The models archive is not a compatible revision 225 model pack.');
    Model.metadata = null;
    Model.unpack(models);
    const metadata: unknown[] | null = Model.metadata as unknown[] | null;
    const ids: number[] = metadata?.flatMap((entry: unknown, id: number): number[] => (entry ? [id] : [])) || [];
    if (!ids.length || ids.length !== ((head[0] << 8) | head[1])) throw new Error('The server models archive is incomplete or incompatible.');
    for (let index: number = 0; index < ids.length; index++) {
        signal.throwIfAborted();
        if (index % 25 === 0) progress(`Converting models for cache tools: ${index + 1} of ${ids.length}…`);
        const encoded: Uint8Array = encodeModel317(Model.model(ids[index]));
        const compressed: ArrayBuffer = await new Response(new Blob([new Uint8Array(encoded).buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        cache.add(1, ids[index], new Uint8Array(compressed));
    }
    signal.throwIfAborted();
    return cache.files();
}

export async function createToolsCacheZip(archives: Uint8Array[], world: number, address: string, signal: AbortSignal, progress: (message: string) => void): Promise<Blob> {
    if (typeof CompressionStream === 'undefined') throw new Error('Classic cache export requires a current Chrome, Edge, Firefox, or Safari browser with gzip compression support.');
    progress('Preparing classic cache conversion…');
    await Bzip.load(new Uint8Array(await downloadUrl('bz2.wasm', 30000, signal)));
    const files: ZipFile[] = await buildToolsCache(archives, signal, progress);
    files.push({
        name: 'README.txt',
        bytes: new TextEncoder().encode(`LoreScape classic cache for Cache viewer and JagEd
World: ${world}
File service: ${address}

On Chromebook, open Cache viewer or JagEd on the LoreScape website and choose
this ZIP directly with Open cache ZIP or files. Alternatively, extract it in
Files > Downloads and select Open cache folder. All six main_file_cache files
are found automatically, and the saved cache loads when you return. No Linux
container is needed. Imported files stay in your browser.

Includes the revision 225 archives in index 0 and models converted to the
classic model format in index 1. Indices 2, 3 and 4 are intentionally empty:
animation, music and map stores are not supplied by this export. This cache
supports model inspection in LoreScape tools; it is not a complete 317 game
cache or an offline game server.
`)
    });
    progress('Preparing the classic cache ZIP…');
    signal.throwIfAborted();
    return createCacheZip(files);
}
