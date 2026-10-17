import Packet from './Packet';
import {downloadUrl} from '../util/JsUtil';

export function validateArchive(bytes: Int8Array, crc: number): void {
    if (bytes.length < 8) throw new Error('The game archive is truncated.');
    const packedLength: number = ((bytes[3] & 255) << 16) | ((bytes[4] & 255) << 8) | (bytes[5] & 255);
    if (packedLength + 6 !== bytes.length) throw new Error('The game archive has an invalid length. The server may have returned an HTML page or an incomplete download.');
    if (Packet.crc32(bytes) !== crc) throw new Error('The game archive does not match the server checksum. Reload to fetch the latest file list; the server must provide matching revision 225 game data.');
}

export async function downloadArchive(url: string, crc: number): Promise<Int8Array> {
    try {
        const bytes: Int8Array = await downloadUrl(url);
        validateArchive(bytes, crc);
        return bytes;
    } catch (error) {
        throw new Error(`Cannot load game archive ${url}. ${error instanceof Error ? error.message : 'Check the game file service.'}`);
    }
}
