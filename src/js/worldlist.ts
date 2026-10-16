import {downloadText, sleep} from './jagex2/util/JsUtil';

export type WorldInfo = {
    id: number;
    region: string;
    address: string;
    portOffset: number;
    players: number;
    members?: boolean;
};

export async function getWorldInfo(secured: boolean, id: number): Promise<WorldInfo> {
    if (!Number.isInteger(id) || id < 1 || id > 997) throw new Error('Choose a valid world number.');
    const endpoint: string = `${secured ? 'https:' : 'http:'}//2004scape.org/api/v1/worldlist`;
    let worldlist: unknown;
    for (let attempt: number = 0; attempt < 3; attempt++) {
        try {
            worldlist = JSON.parse(await downloadText(endpoint, 10000));
            if (!Array.isArray(worldlist)) throw new Error('Invalid world list response.');
            break;
        } catch (error) {
            if (attempt === 2) throw new Error('The world service is unavailable. Please try again later.');
            await sleep(1000);
        }
    }
    const world: WorldInfo | undefined = (worldlist as WorldInfo[]).find((entry: WorldInfo): boolean => entry?.id === id);
    if (!world) throw new Error(`World ${id} is unavailable. Choose another world.`);
    const address: URL = new URL(world.address);
    if (!['http:', 'https:'].includes(address.protocol) || (secured && address.protocol !== 'https:') || !Number.isInteger(world.portOffset)) {
        throw new Error('This world does not provide a compatible connection.');
    }
    return world;
}
