import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_SETTINGS, validateSettings, validateGameMessage } from '../src/public/coop/protocol.mjs';

export function createSignalingService(server, options = {}) {
    const rooms = new Map();
    const attempts = new Map();
    const reservationMs = options.reservationMs ?? 45000;
    const roomMs = options.roomMs ?? 8 * 60 * 60 * 1000;
    const clock = options.clock || Date.now;
    const iceServers = options.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
    const send = (ws, msg) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Dropping bytes would corrupt the ordered game stream. Disconnect instead.
        if (ws.bufferedAmount >= 1024 * 1024) { ws.terminate(); remove(ws); return; }
        ws.send(JSON.stringify(msg));
    };
    const owner = ws => ws.role === 'host' && ws.room?.host === ws;
    function broadcast(room) {
        const roster = [{ id: room.host.id, name: room.host.name || 'Host', state: room.host.playing ? 'playing' : 'ready', host: true }, ...[...room.guests.values()].map(ws => ({ id: ws.id, name: ws.name || 'Guest', state: ws.active ? (ws.playing ? 'playing' : 'connected') : 'joining', host: false }))];
        for (const ws of [room.host, ...room.guests.values()]) send(ws, { type: 'roster', roster, settings: room.settings });
    }
    function remove(ws) {
        const room = ws.room;
        if (!room) return;
        ws.room = null;
        if (room.host === ws) {
            rooms.delete(room.code);
            for (const guest of room.guests.values()) { guest.room = null; send(guest, { type: 'ended', reason: 'The host has left. Ask them to reopen their saved world.' }); }
            room.guests.clear();
        } else if (room.guests.delete(ws.id)) { send(room.host, { type: 'guest-left', id: ws.id }); broadcast(room); }
    }
    function fail(ws, message) { send(ws, { type: 'error', message }); }
    function authorizeHost(ws, msg) {
        if (!owner(ws) || typeof msg.token !== 'string' || msg.token.length !== ws.room.token.length || !timingSafeEqual(Buffer.from(msg.token), Buffer.from(ws.room.token))) throw new Error('Host authorization required');
    }
    function sweep() {
        for (const room of rooms.values()) {
            if (clock() - room.created >= roomMs) { send(room.host, { type: 'ended', reason: 'Room expired. Reopen the saved world to create a new room.' }); remove(room.host); continue; }
            for (const guest of room.guests.values()) if (!guest.active && clock() > guest.deadline) { send(guest, { type: 'ended', reason: 'Joining timed out. Try the room code again.' }); remove(guest); }
        }
        for (const [ip, entry] of attempts) if (clock() - entry.since > 60000) attempts.delete(ip);
    }
    server.on('upgrade', (request, socket, head) => {
        if (request.url !== '/signal') { socket.destroy(); return; }
        // Same-origin browser access; non-browser test clients may omit Origin.
        const origin = request.headers.origin;
        if (origin && !options.allowedOrigins?.includes(origin) && ![ `http://${request.headers.host}`, `https://${request.headers.host}` ].includes(origin)) { socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
    });
    wss.on('connection', (ws, request) => {
        ws.id = randomUUID(); ws.alive = true; ws.frames = 0; ws.bytes = 0; ws.window = clock();
        ws.on('pong', () => { ws.alive = true; });
        ws.on('error', () => remove(ws));
        ws.on('close', () => remove(ws));
        ws.on('message', raw => {
            try {
                if (clock() - ws.window >= 1000) { ws.frames = 0; ws.bytes = 0; ws.window = clock(); }
                if (++ws.frames > 1000 || (ws.bytes += raw.length) > (owner(ws) ? 4 : 1) * 1024 * 1024) throw new Error('Connection rate limit exceeded');
                const msg = JSON.parse(raw.toString());
                if (!msg || typeof msg.type !== 'string') throw new Error('Malformed request');
                if (msg.type === 'create' || msg.type === 'join') {
                    if (ws.room) throw new Error('Already in a room');
                    const ip = request.socket.remoteAddress;
                    const entry = attempts.get(ip) || { since: clock(), count: 0 };
                    if (clock() - entry.since >= 60000) { entry.count = 0; entry.since = clock(); }
                    if (++entry.count > 30) throw new Error('Too many room attempts. Try again in a minute.');
                    attempts.set(ip, entry);
                    sweep();
                    ws.id = randomUUID();
                    if (msg.type === 'create') {
                        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(msg.worldId || '')) throw new Error('Invalid world');
                        if (rooms.size >= 100) throw new Error('Room service is full');
                        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                        let code;
                        do { code = [...randomBytes(8)].map(byte => alphabet[byte & 31]).join(''); } while (rooms.has(code));
                        const settings = validateSettings(msg.settings || DEFAULT_SETTINGS);
                        const room = { code, host: ws, token: randomBytes(32).toString('hex'), worldId: msg.worldId, settings, guests: new Map(), created: clock() };
                        rooms.set(code, room); ws.room = room; ws.role = 'host';
                        send(ws, { type: 'created', code, id: ws.id, token: room.token, worldId: room.worldId, settings, iceServers }); broadcast(room);
                    } else {
                        const code = String(msg.code || '').replace(/[ -]/g, '').toUpperCase();
                        const room = rooms.get(code);
                        if (!room) throw new Error('Room code is invalid or expired');
                        if (room.guests.size >= 3) throw new Error('Room is full (four players including the host)');
                        ws.room = room; ws.role = 'guest'; ws.deadline = clock() + reservationMs; ws.active = false; ws.ready = false;
                        room.guests.set(ws.id, ws);
                        send(ws, { type: 'joined', id: ws.id, code, worldId: room.worldId, settings: room.settings, iceServers });
                        send(room.host, { type: 'guest-reserved', id: ws.id }); broadcast(room);
                    }
                    return;
                }
                const room = ws.room;
                if (!room) throw new Error('Join a room first');
                if (msg.type === 'leave') { remove(ws); send(ws, { type: 'left' }); return; }
                if (msg.type === 'ready' && ws.role === 'guest') { if (ws.ready) throw new Error('Negotiation already started'); ws.ready = true; send(room.host, { type: 'guest-ready', id: ws.id, relay: msg.relay === true }); return; }
                if (msg.type === 'active') {
                    authorizeHost(ws, msg);
                    const guest = room.guests.get(msg.to); if (!guest) throw new Error('Guest reservation expired');
                    guest.active = true; send(guest, { type: 'active', id: guest.id }); broadcast(room); return;
                }
                if (msg.type === 'settings') { authorizeHost(ws, msg); room.settings = validateSettings(msg.settings); broadcast(room); return; }
                if (msg.type === 'kick') { authorizeHost(ws, msg); const guest = room.guests.get(msg.to); if (guest) { send(guest, { type: 'ended', reason: 'The host removed you from the room.' }); remove(guest); } return; }
                if (msg.type === 'presence') {
                    if (typeof msg.name !== 'string' || !/^[a-zA-Z0-9 _]{1,12}$/.test(msg.name)) throw new Error('Invalid character name');
                    ws.name = msg.name; ws.playing = msg.playing === true; broadcast(room); return;
                }
                if (msg.type === 'guest-presence') {
                    authorizeHost(ws, msg); const guest = room.guests.get(msg.to);
                    if (guest && typeof msg.name === 'string' && /^[a-zA-Z0-9 _]{1,12}$/.test(msg.name)) { guest.name = msg.name; guest.playing = msg.playing === true; broadcast(room); }
                    return;
                }
                if (['offer', 'answer', 'ice', 'relay-open', 'relay'].includes(msg.type)) {
                    const target = owner(ws) ? room.guests.get(msg.to) : room.host;
                    if (!target || (msg.type === 'offer' && !owner(ws)) || (msg.type === 'answer' && owner(ws))) throw new Error('Invalid negotiation participant');
                    if (msg.type === 'offer' || msg.type === 'answer') {
                        if (typeof msg.sdp !== 'string' || msg.sdp.length > 24000) throw new Error('Invalid session description');
                    } else if (msg.type === 'ice') {
                        if (!msg.candidate || JSON.stringify(msg.candidate).length > 2048) throw new Error('Invalid ICE candidate');
                    } else if (msg.type === 'relay') {
                        const guest = owner(ws) ? target : ws;
                        if (!guest.active || !guest.relay) throw new Error('Relay has not been admitted');
                        if (!owner(ws)) msg.message = validateGameMessage(msg.message);
                        else if (!msg.message || msg.message.type !== 'data' || !Array.isArray(msg.message.data) || msg.message.data.length > 5000) throw new Error('Invalid outgoing relay packet');
                    } else {
                        if (owner(ws)) { target.relay = true; target.active = true; broadcast(room); }
                    }
                    send(target, { type: msg.type, id: owner(ws) ? target.id : ws.id, sdp: msg.sdp, candidate: msg.candidate, message: msg.message }); return;
                }
                throw new Error('Unknown request');
            } catch (error) { fail(ws, error.message); }
        });
    });
    const timer = setInterval(() => {
        sweep();
        for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); remove(ws); } else { ws.alive = false; ws.ping(); } }
    }, 15000);
    timer.unref();
    return { rooms, sweep, close: () => { clearInterval(timer); for (const ws of wss.clients) ws.terminate(); wss.close(); } };
}
