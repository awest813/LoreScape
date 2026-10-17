import {DEFAULT_LOCAL_ADDRESS, localWorldAddresses, worldAddresses} from './connection';
import {getWorldInfo, WorldInfo} from './worldlist';
import {downloadArchive} from './jagex2/io/ArchiveDownload';
import {loadClientChecksums} from './local-worlds';
import {createCacheZip, ZipFile} from './cache-zip';

export type CacheSource = {world: number; address: string};
export async function resolveCacheSource(world: number, address: string, securePage: boolean, signal: AbortSignal): Promise<CacheSource> {
    signal.throwIfAborted();
    if (world === 0) return {world, address: localWorldAddresses(address || DEFAULT_LOCAL_ADDRESS, securePage).files};
    if (world === 998 || world === 999) return {world, address: 'data/pack/client'};
    const info: WorldInfo = await getWorldInfo(securePage, world, signal);
    return {world, address: worldAddresses(info.address, info.portOffset, securePage, info.websocketAddress).files};
}

const archiveNames: string[] = ['title', 'config', 'interface', 'media', 'models', 'textures', 'wordenc', 'sounds'];

export async function downloadServerCache(source: CacheSource, signal: AbortSignal, progress: (message: string) => void): Promise<Blob> {
    signal.throwIfAborted();
    progress('Fetching the server checksum table…');
    const crc: Int8Array = await loadClientChecksums(source.address, source.world, signal);
    const checksums: DataView = new DataView(crc.buffer, crc.byteOffset, crc.byteLength);
    const files: ZipFile[] = [{name: 'data/pack/client/crc', bytes: Uint8Array.from(crc)}];
    let total: number = crc.length;
    for (let index: number = 0; index < archiveNames.length; index++) {
        signal.throwIfAborted();
        const name: string = archiveNames[index];
        progress(`Downloading ${index + 1} of ${archiveNames.length}: ${name}…`);
        signal.throwIfAborted();
        const checksum: number = checksums.getInt32((index + 1) * 4);
        const url: string = `${source.address}/${name}${source.world < 998 ? checksum : ''}`;
        const bytes: Int8Array = await downloadArchive(url, checksum, signal);
        total += bytes.length;
        if (total > 64 * 1024 * 1024) throw new Error('This cache exceeds the 64 MB browser export limit. No ZIP was saved.');
        files.push({name: `data/pack/client/${name}`, bytes: Uint8Array.from(bytes)});
    }
    signal.throwIfAborted();
    const note: string = `LoreScape core client cache — revision 225
World: ${source.world}
File service: ${source.address}

Includes the eight startup archives and their original CRC table. Each archive
was checked against that table before this ZIP was created.

On a Chromebook, find this ZIP in Files > Downloads and open it to extract.
The data/pack/client/ layout is for compatible browser worker/peer bundles.
This is not a main_file_cache.dat/.idx cache for Cache viewer or JagEd.
Maps, music, server code, player saves, and a game server are not included.
This download alone does not enable offline play.
`;
    files.push({name: 'README.txt', bytes: new TextEncoder().encode(note)});
    progress('Preparing the ZIP download…');
    return createCacheZip(files);
}

export function saveCacheZip(blob: Blob, world: number): void {
    const url: string = URL.createObjectURL(blob);
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = url;
    link.download = `lorescape-world-${world}-core-cache.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    // Let Chrome finish consuming the download URL before releasing it.
    setTimeout((): void => URL.revokeObjectURL(url), 60000);
}
