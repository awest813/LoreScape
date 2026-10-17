import GameShell from './jagex2/client/GameShell';
import {Client} from './client';
import {getWorldInfo, WorldInfo} from './worldlist';
import {worldAddresses} from './connection';

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
        localConfiguration();
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

function localConfiguration(): void {
    if (+GameShell.getParameter('world') >= 998) {
        Client.httpAddress = 'data/pack/client';
        return;
    }

    if (window.location.protocol === 'https:') throw new Error('World 0 requires the local HTTP development site.');

    Client.serverAddress = 'http://localhost';
    Client.httpAddress = 'http://localhost';
    Client.portOffset = 0;
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
