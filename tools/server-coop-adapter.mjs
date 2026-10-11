import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './coop-config.mjs';

function replace(source, before, after) {
    if (!source.includes(before)) throw new Error(`Pinned server adaptation failed: ${before.slice(0, 100)}`);
    return source.replace(before, after);
}
export const coopServer = {
    name: 'lorescape-coop-server',
    setup(build) {
        build.onLoad({filter: /[/\\]jagex[/\\]io[/\\]Packet\.ts$/}, ({path: filename}) => {
            const source = replace(readFileSync(filename, 'utf8'), 'const packet = new Packet(new Uint8Array(await (await fetch(path)).arrayBuffer()));', "const response = await fetch(path);\n        if (!response.ok) throw new Error(`Game asset unavailable: ${path}`);\n        const packet = new Packet(new Uint8Array(await response.arrayBuffer()));");
            return {contents: source, loader: 'ts', resolveDir: path.dirname(filename)};
        });
        build.onLoad({filter: /[/\\]lostcity[/\\]util[/\\]Logger\.ts$/}, ({path: filename}) => {
            return {contents: replace(readFileSync(filename, 'utf8'), 'process.exit(1);', 'throw new Error(message);'), loader: 'ts', resolveDir: path.dirname(filename)};
        });
        build.onLoad({ filter: /[/\\]lostcity[/\\](worker|engine[/\\](World|Login)|entity[/\\]Player|server[/\\](WorkerServer|LoginThread|ClientSocket)|engine[/\\]script[/\\]handlers[/\\]ObjOps)\.ts$/ }, ({ path: filename }) => {
            let source = readFileSync(filename, 'utf8');
            const leaf = path.basename(filename);
            if (leaf === 'worker.ts') {
                source = "import Login from '#lostcity/engine/Login.js';\nimport {installCoop} from " + JSON.stringify(path.join(root, 'tools/server-coop-runtime.mjs')) + ';\n' + source;
                source = replace(source, 'await World.start();', 'const coop = installCoop(World, Login);\nawait coop.load();\nawait World.start(false, false);\nawait coop.restore();');
                source += '\nWorld.cycle();\n';
            } else if (leaf === 'World.ts') {
                source = replace(source, 'const start: number = Date.now();', 'const start: number = Date.now();\n            globalThis.__coop?.tick();');
            } else if (leaf === 'Player.ts') {
                source = replace(source, 'const multi = Number(Environment.NODE_XPRATE) || 1;', 'const multi = globalThis.__coop?.settings.xpRate || 1;');
                source = replace(source, 'sav.save(`data/players/${safeName}.sav`);', 'if (!Environment.STANDALONE_BUNDLE) sav.save(`data/players/${safeName}.sav`);');
            } else if (leaf === 'Login.ts') {
                source = replace(source, 'switch (msg.type) {', "if (msg.type?.startsWith('coop-')) return;\n        switch (msg.type) {");
                source = replace(source, 'World.getTotalPlayers() >= 2000', 'World.getTotalPlayers() + World.newPlayers.size >= 4');
                source = replace(source, 'for (const player of World.players)', 'for (const player of [...World.players, ...World.newPlayers])');
            } else if (leaf === 'ClientSocket.ts') {
                source = replace(source, 'uniqueId: string = randomUUID()', 'uniqueId: string = crypto.randomUUID()');
            } else if (leaf === 'WorkerServer.ts') {
                source = replace(source, "case 'connection': {", "case 'connection': {\n                    if (!globalThis.__coop.admissions.has(e.data.id) || this.sockets.has(e.data.id) || this.sockets.size >= 4) return;");
                source = replace(source, "case 'data': {", "case 'data': {\n                    if (!globalThis.__coop.admissions.has(e.data.id) || !Array.isArray(e.data.data) && !(e.data.data instanceof Uint8Array) || e.data.data.length > 5000) return;");
                source = replace(source, "case 'close': {", "case 'close': {\n                    Login.loginRequests.delete(e.data.id);\n                    for (const player of World.newPlayers) if (player.client?.uniqueId === e.data.id) { World.newPlayers.delete(player); Login.logout(player); }\n                    if (socket?.player && socket.player.pid !== -1) { socket.player.client = new NullClientSocket(); World.removePlayer(socket.player); }");
            } else if (leaf === 'LoginThread.ts') {
                const helper = `const coopRequests = new Map();
function coopStorage(action, payload) {
    return new Promise((resolve, reject) => {
        const requestId = 'login:' + crypto.randomUUID();
        const timer = setTimeout(() => { coopRequests.delete(requestId); reject(new Error('Host storage timed out')); }, 30000);
        coopRequests.set(requestId, {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}});
        self.postMessage({type:'coop-storage', action, requestId, ...payload});
    });
}
self.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type !== 'coop-storage-result') return;
    const request = coopRequests.get(msg.requestId);
    if (request) { coopRequests.delete(msg.requestId); msg.error ? request.reject(new Error(msg.error)) : request.resolve(msg.value); }
});\n`;
                source = helper + source;
                source = replace(source, 'async function handleRequests(parentPort: any, msg: any, priv: forge.pki.rsa.PrivateKey) {', "async function handleRequests(parentPort: any, msg: any, priv: forge.pki.rsa.PrivateKey) {\n    if (msg.type?.startsWith('coop-')) return;");
                const old = "const saveFile = await fetch(`data/players/${safeName}.sav`);\n                    if (saveFile.ok) {\n                        save = new Uint8Array(await saveFile.arrayBuffer());\n                    }";
                source = replace(source, old, "save = new Uint8Array(await coopStorage('load-character', {name: safeName}));");
                for (const kind of ['logout', 'autosave']) {
                    const old = `case '${kind}': {\n            if (!Environment.LOGIN_KEY) {\n                return;\n            }`;
                    source = replace(source, old, `case '${kind}': {\n            if (Environment.STANDALONE_BUNDLE) {\n                await coopStorage('checkpoint', {characters: [{name: msg.username, bytes: Array.from(msg.save)}]});\n                return;\n            }\n            if (!Environment.LOGIN_KEY) return;`);
                }
            } else if (leaf === 'ObjOps.ts') {
                source = "import {isNpcLoot, lootCount} from " + JSON.stringify(path.join(root, 'src/public/coop/protocol.mjs')) + ';\n' + source;
                source = replace(source, 'const [coord, objId, count, duration] = state.popInts(4);', 'let [coord, objId, count, duration] = state.popInts(4);');
                source = replace(source, 'check(count, ObjStackValid);', 'check(count, ObjStackValid);\n        const npcLoot = isNpcLoot(state);\n        const settings = globalThis.__coop.settings;\n        count = lootCount(count, objType.tradeable, npcLoot, settings);\n        const receiverId = npcLoot && objType.tradeable && settings.lootMode === "shared" ? -1 : state.activePlayer.pid;');
                source = source.replaceAll('World.addObj(obj, state.activePlayer.pid, duration);', 'World.addObj(obj, receiverId, duration);');
            }
            return { contents: source, loader: 'ts', resolveDir: path.dirname(filename) };
        });
    }
};
