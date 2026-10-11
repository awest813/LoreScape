type Signal = {type: string; id: string; sdp?: string; candidate?: RTCIceCandidateInit; relay?: boolean; message?: {type: string; data?: number[]; id?: string}};
type Context = {
    id: string;
    iceServers: RTCIceServer[];
    transportMode: string;
    send(message: object): void;
    attachTransport(transport: Host | Peer): void;
    notify(message: string, error?: boolean): void;
};
type Channel = {readyState: string; send(data: string): void; close(): void};
type Entry = {pc?: RTCPeerConnection; dc?: Channel; active: boolean; relay: boolean; candidates: RTCIceCandidateInit[]};
function context(): Context {
    const value: Context | undefined = (window.parent as Window & {LoreCoop?: Context}).LoreCoop;
    if (!value) throw new Error('Open /coop.html to create or join a private room.');
    return value;
}
function packet(raw: unknown): {type: string; data?: number[]} {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid game message');
    const msg: {type: string; data?: number[] | Record<string, number>} = raw as {type: string; data?: number[] | Record<string, number>};
    if (!['connection', 'data', 'close'].includes(msg.type)) throw new Error('Invalid game message type');
    if (msg.type !== 'data') return {type: msg.type};
    const data: number[] = Array.isArray(msg.data) ? msg.data : Object.values(msg.data || {});
    if (!data.length || data.length > 5000 || !data.every((byte): boolean => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error('Invalid game packet');
    return {type: 'data', data};
}
export class Host {
    private peers = new Map<string, Entry>();
    private ctx: Context;
    private ready = false;
    private queued: Signal[] = [];
    public uniqueId: string;
    constructor(private worker: Worker) {
        this.ctx = context();
        this.uniqueId = this.ctx.id;
        this.ctx.attachTransport(this);
        worker.postMessage({type: 'coop-host', id: this.uniqueId});
    }
    async setupPeerConnection(): Promise<void> {
        this.ctx.notify('Share the room code from the party panel. Guests join without clipboard handshakes.');
    }
    signal(msg: Signal): void {
        this.handleSignal(msg).catch((error): void => {
            this.ctx.notify(String(error), true);
            if (msg.id) {
                this.remove(msg.id);
                this.ctx.send({type: 'kick', to: msg.id});
            }
        });
    }
    private async handleSignal(msg: Signal): Promise<void> {
        if (msg.type === 'guest-reserved') {
            if (this.peers.size >= 3 || this.peers.has(msg.id)) {
                this.ctx.send({type: 'kick', to: msg.id});
                return;
            }
            this.peers.set(msg.id, {active: false, relay: false, candidates: []});
            if (this.ready) this.worker.postMessage({type: 'coop-admit', id: msg.id});
            return;
        }
        if (msg.type === 'guest-left') {
            this.remove(msg.id);
            return;
        }
        const entry: Entry | undefined = this.peers.get(msg.id);
        if (!entry) return;
        if (msg.type === 'guest-ready') {
            if (!this.ready) {
                this.queued.push(msg);
                return;
            }
            if (msg.relay) {
                this.openRelay(msg.id, entry);
                return;
            }
            const pc: RTCPeerConnection = new RTCPeerConnection({iceServers: this.ctx.iceServers});
            entry.pc = pc;
            pc.onicecandidate = (event): void => {
                if (event.candidate) this.ctx.send({type: 'ice', to: msg.id, candidate: event.candidate.toJSON()});
            };
            pc.onconnectionstatechange = (): void => {
                if (pc.connectionState === 'failed' && !entry.relay && entry.active) {
                    this.remove(msg.id);
                    this.ctx.send({type: 'kick', to: msg.id});
                }
            };
            const dc: RTCDataChannel = pc.createDataChannel('lorescape');
            entry.dc = dc;
            dc.onopen = (): void => {
                if (entry.relay) return;
                entry.active = true;
                dc.send(JSON.stringify({type: 'id', id: msg.id}));
                this.ctx.send({type: 'active', to: msg.id});
            };
            dc.onmessage = (event): void => this.receive(msg.id, event.data);
            dc.onclose = (): void => {
                if (entry.active && !entry.relay) {
                    this.remove(msg.id);
                    this.ctx.send({type: 'kick', to: msg.id});
                }
            };
            dc.onerror = (): void => {
                if (!entry.active) this.ctx.notify('A peer connection failed. Relay mode can connect restricted browsers.');
            };
            await pc.setLocalDescription(await pc.createOffer());
            this.ctx.send({type: 'offer', to: msg.id, sdp: pc.localDescription!.sdp});
        } else if (msg.type === 'answer' && entry.pc && !entry.relay) {
            await entry.pc.setRemoteDescription({type: 'answer', sdp: msg.sdp});
            for (const candidate of entry.candidates.splice(0)) await entry.pc.addIceCandidate(candidate);
        } else if (msg.type === 'ice' && msg.candidate && !entry.relay) {
            if (entry.pc?.remoteDescription) await entry.pc.addIceCandidate(msg.candidate);
            else if (entry.candidates.length < 100) entry.candidates.push(msg.candidate);
        } else if (msg.type === 'relay-open') this.openRelay(msg.id, entry);
        else if (msg.type === 'relay' && entry.relay) this.receive(msg.id, JSON.stringify(msg.message));
    }
    onWorkerReady(): void {
        this.ready = true;
        this.worker.postMessage({type: 'coop-host', id: this.uniqueId});
        for (const id of this.peers.keys()) this.worker.postMessage({type: 'coop-admit', id});
        for (const signal of this.queued.splice(0)) if (this.peers.has(signal.id)) this.signal(signal);
    }
    private openRelay(id: string, entry: Entry): void {
        if (entry.active && !entry.relay) {
            this.ctx.notify('An established connection failed. Leave and rejoin to reconnect.');
            return;
        }
        entry.relay = true;
        entry.active = true;
        entry.dc?.close();
        entry.pc?.close();
        entry.dc = undefined;
        this.ctx.send({type: 'relay-open', to: id});
    }
    private receive(id: string, raw: string): void {
        const entry: Entry | undefined = this.peers.get(id);
        if (!entry?.active) return;
        try {
            const msg: {type: string; data?: number[]} = packet(JSON.parse(raw));
            this.worker.postMessage({...msg, id});
        } catch {
            this.remove(id);
            this.ctx.send({type: 'kick', to: id});
        }
    }
    public postMessage(event: MessageEvent): void {
        const entry: Entry | undefined = this.peers.get(event.data.id);
        if (!entry?.active) return;
        const message: {type: string; id: string; data?: number[]} = {...event.data, data: event.data.data ? Array.from(event.data.data as Uint8Array) : undefined};
        if (entry.relay) this.ctx.send({type: 'relay', to: event.data.id, message});
        else if (entry.dc?.readyState === 'open') entry.dc.send(JSON.stringify(message));
    }
    updatePresence(players: {id: string; name: string}[]): void {
        for (const [id, entry] of this.peers) {
            const name: string | undefined = players.find((player): boolean => player.id === id)?.name;
            if (entry.relay) this.ctx.send({type: 'guest-presence', to: id, name: name || 'Guest', playing: !!name});
            else if (entry.dc?.readyState === 'open') entry.dc.send(JSON.stringify({type: 'presence', name: name || '', playing: !!name}));
        }
    }
    remove(id: string): void {
        const entry: Entry | undefined = this.peers.get(id);
        if (!entry) return;
        this.peers.delete(id);
        entry.active = false;
        entry.dc?.close();
        entry.pc?.close();
        this.worker.postMessage({type: 'coop-revoke', id});
    }
    dispose(): void {
        for (const id of [...this.peers.keys()]) this.remove(id);
    }
}
export class Peer {
    public pc: RTCPeerConnection;
    public dc: Channel | undefined;
    public uniqueId: string | undefined;
    private ctx: Context;
    private candidates: RTCIceCandidateInit[] = [];
    private relay = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(private worker: Worker) {
        this.ctx = context();
        this.pc = new RTCPeerConnection({iceServers: this.ctx.iceServers});
        this.pc.onicecandidate = (event): void => {
            if (event.candidate && !this.relay) this.ctx.send({type: 'ice', candidate: event.candidate.toJSON()});
        };
        this.pc.ondatachannel = (event): void => {
            if (this.relay) {
                event.channel.close();
                return;
            }
            this.dc = event.channel;
            event.channel.onmessage = (e): void => {
                try {
                    this.receive(JSON.parse(e.data));
                } catch {
                    this.ctx.notify('Invalid host packet. Leave and rejoin the room.', true);
                    this.ctx.send({type: 'leave'});
                }
            };
            event.channel.onclose = (): void => {
                if (!this.relay) {
                    this.ctx.notify('Host connection closed. Leave and rejoin the room.', true);
                    this.ctx.send({type: 'leave'});
                }
            };
        };
        this.ctx.attachTransport(this);
        this.ctx.send({type: 'ready', relay: this.ctx.transportMode === 'relay'});
        if (this.ctx.transportMode === 'auto')
            this.timer = setTimeout((): void => {
                if (!this.uniqueId) this.ctx.send({type: 'relay-open'});
            }, 10000);
    }
    signal(msg: Signal): void {
        this.handleSignal(msg).catch((error): void => this.ctx.notify(String(error), true));
    }
    private async handleSignal(msg: Signal): Promise<void> {
        if (msg.type === 'offer' && !this.relay) await this.handleOffer(msg.sdp || '');
        else if (msg.type === 'ice' && msg.candidate && !this.relay) {
            if (this.pc.remoteDescription) await this.pc.addIceCandidate(msg.candidate);
            else if (this.candidates.length < 100) this.candidates.push(msg.candidate);
        } else if (msg.type === 'relay-open') {
            this.relay = true;
            this.pc.close();
            clearTimeout(this.timer);
            this.uniqueId = this.ctx.id;
            this.dc = {
                readyState: 'open',
                send: (raw): void => this.ctx.send({type: 'relay', message: JSON.parse(raw)}),
                close: (): void => {
                    this.dc = undefined;
                }
            };
            this.ctx.notify('Connected using relay. Log in with your character name.');
        } else if (msg.type === 'relay' && this.relay && msg.message) this.receive(msg.message);
    }
    private receive(msg: {type: string; id?: string; name?: string; playing?: boolean; data?: number[]}): void {
        if (msg.type === 'id') {
            this.uniqueId = msg.id;
            clearTimeout(this.timer);
            this.ctx.notify('Connected to the host. Log in with your character name.');
            return;
        }
        if (msg.type === 'presence') {
            if (msg.name) this.ctx.send({type: 'presence', name: msg.name, playing: msg.playing});
            return;
        }
        if (msg.type === 'data' && this.worker.onmessage) this.worker.onmessage(new MessageEvent('message', {data: JSON.stringify(msg)}));
    }
    public async handleOffer(sdp: string): Promise<void> {
        await this.pc.setRemoteDescription({type: 'offer', sdp});
        for (const candidate of this.candidates.splice(0)) await this.pc.addIceCandidate(candidate);
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.ctx.send({type: 'answer', sdp: this.pc.localDescription!.sdp});
    }
    dispose(): void {
        clearTimeout(this.timer);
        this.relay = true;
        this.dc?.close();
        this.pc.close();
    }
}
