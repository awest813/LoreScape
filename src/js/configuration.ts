import GameShell from './jagex2/client/GameShell';
import {Client} from './client';
import {getWorldInfo, WorldInfo} from './worldlist';
import {DEFAULT_LOCAL_ADDRESS, localWorldAddresses, worldAddresses} from './connection';
import {parseSetupKey} from './setup-key';

export function packFileUrl(name: 'npc' | 'obj' | 'sound'): string {
    return GameShell.getParameter('world') === '0' && GameShell.getParameter('setup') === '1' ? `${Client.httpAddress}/tool-data/${name}.pack` : `${Client.githubRepository}/data/src/pack/${name}.pack`;
}

export async function setupConfiguration(): Promise<void> {
    await world();
    detail();
    method();
}

// setup the world config.
async function world(): Promise<void> {
    if (GameShell.getParameter('world').length === 0) {
        GameShell.setParameter('world', '1');
    }
    if (['0', '998', '999'].includes(GameShell.getParameter('world'))) {
        await localConfiguration();
    } else {
        await liveConfiguration(window.location.protocol.startsWith('https'));
    }
}

// setup the detail
function detail(): void {
    if (!['high', 'low'].includes(GameShell.getParameter('detail'))) {
        GameShell.setParameter('detail', 'high');
    }
    if (GameShell.getParameter('detail') === 'low') {
        Client.setLowMemory();
    } else {
        Client.setHighMemory();
    }
}

// setup the method
function method(): void {
    if (GameShell.getParameter('method').length === 0) {
        GameShell.setParameter('method', '0');
    }
}

// ---

async function localConfiguration(): Promise<void> {
    if (+GameShell.getParameter('world') >= 998) {
        Client.httpAddress = 'data/pack/client';
        return;
    }

    const addresses: {files: string; host: string; sockets: string[]} = localWorldAddresses(GameShell.getParameter('local') || DEFAULT_LOCAL_ADDRESS, window.location.protocol === 'https:');
    Client.serverAddress = addresses.host;
    Client.httpAddress = addresses.files;
    Client.webSocketAddresses = addresses.sockets;
    Client.portOffset = 0;
    if (GameShell.getParameter('setup') === '1') {
        if (addresses.files !== window.location.origin) throw new Error('Open the setup kit launcher on the same address as its game server.');
        const response: Response = await fetch('/lorescape-server.json', {signal: AbortSignal.timeout(10000), cache: 'no-store'});
        if (!response.ok) throw new Error('Setup kit login configuration is unavailable. Restart node start.cjs and open its launcher link.');
        Client.modulus = parseSetupKey(await response.json());
        Client.exponent = 65537n;
    }
}

async function liveConfiguration(secured: boolean): Promise<void> {
    const world: WorldInfo = await getWorldInfo(secured, Number(GameShell.getParameter('world')));
    const addresses: {files: string; host: string; sockets: string[]} = worldAddresses(world.address, world.portOffset, secured, world.websocketAddress);
    Client.nodeId = 10 + world.id - 1;
    Client.serverAddress = addresses.host;
    Client.httpAddress = addresses.files;
    Client.webSocketAddresses = addresses.sockets;
    Client.portOffset = world.portOffset;
    Client.members = world?.members === true;
    GameShell.setParameter('world', world.id.toString(10));
}
