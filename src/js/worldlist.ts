import {downloadText, sleep} from './jagex2/util/JsUtil';
import {WORLD_LIST_URL, worldAddresses} from './connection';

export type WorldInfo = {
    id: number;
    region: string;
    address: string;
    portOffset: number;
    players: number;
    members?: boolean;
    websocketAddress?: string;
};

export async function getWorldInfo(secured: boolean, id: number, signal?: AbortSignal): Promise<WorldInfo> {
    if (!Number.isInteger(id) || id < 1 || id > 997) throw new Error('Choose a valid world number.');
    const endpoint: string = WORLD_LIST_URL;
    let worldlist: unknown;
    for (let attempt: number = 0; attempt < 3; attempt++) {
        try {
            worldlist = JSON.parse(await (signal ? downloadText(endpoint, 10000, signal) : downloadText(endpoint, 10000)));
            if (!Array.isArray(worldlist)) throw new Error('Invalid world list response.');
            break;
        } catch (error) {
            if (signal?.aborted) throw error;
            if (attempt === 2) throw new Error(`The world service is unavailable at ${endpoint}. ${error instanceof Error ? error.message : ''} Check your network and browser restrictions, or try the official 2004Scape site.`);
            await sleep(1000);
        }
    }
    const world: WorldInfo | undefined = (worldlist as WorldInfo[]).find((entry: WorldInfo): boolean => entry?.id === id);
    if (!world) throw new Error(`World ${id} is unavailable. Choose another world.`);
    if (!Number.isInteger(world.portOffset)) throw new Error('This world does not provide a compatible connection.');
    try {
        worldAddresses(world.address, world.portOffset, secured, world.websocketAddress);
    } catch {
        throw new Error('This world does not provide a compatible connection.');
    }
    return world;
}
