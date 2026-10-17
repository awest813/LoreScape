import {setPageStatus} from '../../page-shell';

type PeerMessage = {type: string; id: string; data?: number[] | Uint8Array};

function connectionId(): string {
    // randomUUID is unavailable on some HTTP development origins.
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte: number): string => byte.toString(16).padStart(2, '0')).join('');
}

async function gatherIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve, reject): void => {
        const cleanup = (): void => {
            clearTimeout(timer);
            pc.removeEventListener('icegatheringstatechange', changed);
        };
        const changed = (): void => {
            if (pc.iceGatheringState === 'complete') {
                cleanup();
                resolve();
            }
        };
        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
            cleanup();
            reject(new Error('Peer discovery timed out. Check your network and try again.'));
        }, 15000);
        pc.addEventListener('icegatheringstatechange', changed);
        changed();
    });
}

async function copyDescription(pc: RTCPeerConnection, kind: string): Promise<boolean> {
    await gatherIce(pc);
    const description: string = JSON.stringify(pc.localDescription);
    try {
        await navigator.clipboard.writeText(description);
        return true;
    } catch {
        return prompt(`Copy this ${kind} and send it to the other player. Cancel to stop.`, description) !== null;
    }
}

export class Host {
    private peers: Map<string, RTCDataChannel> = new Map();
    public uniqueId: string = connectionId();

    constructor(private readonly worker: Worker) {}

    async setupPeerConnection(): Promise<void> {
        const pc: RTCPeerConnection = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
        const dc: RTCDataChannel = pc.createDataChannel('channel');
        const id: string = connectionId();
        this.peers.set(id, dc);
        const disconnect = (): void => {
            if (!this.peers.delete(id)) return;
            this.worker.postMessage({type: 'close', id});
            dc.close();
            pc.close();
        };
        dc.onclose = disconnect;
        dc.onerror = disconnect;
        pc.onconnectionstatechange = (): void => {
            if (['failed', 'closed'].includes(pc.connectionState)) disconnect();
        };
        dc.onopen = (): void => {
            dc.send(JSON.stringify({type: 'id', id}));
            setPageStatus('A peer joined your browser world.');
        };
        dc.onmessage = (event: MessageEvent): void => {
            try {
                const msg: PeerMessage = JSON.parse(event.data);
                if (!['connection', 'data', 'close'].includes(msg.type)) return;
                // A guest must never address another player's worker connection.
                this.worker.postMessage({...msg, id, ...(msg.data ? {data: Object.values(msg.data)} : {})});
            } catch {
                disconnect();
            }
        };
        try {
            await pc.setLocalDescription(await pc.createOffer());
            if (!(await copyDescription(pc, 'offer'))) {
                disconnect();
                return;
            }
            const answer: string | null = prompt('Send the offer to your guest, then paste their answer here. Cancel to stop.');
            if (!answer) {
                disconnect();
                return;
            }
            const remote: RTCSessionDescriptionInit = JSON.parse(answer);
            if (remote.type !== 'answer' || typeof remote.sdp !== 'string') throw new Error('Paste a valid peer answer.');
            await pc.setRemoteDescription(remote);
            setPageStatus('Peer invitation accepted. Waiting for the connection…');
        } catch (error) {
            disconnect();
            setPageStatus(error instanceof Error ? error.message : 'Unable to connect to the peer.', true);
        }
    }

    public postMessage(event: MessageEvent): void {
        const msg: PeerMessage = event.data;
        const dc: RTCDataChannel | undefined = this.peers.get(msg.id);
        if (dc?.readyState === 'open') dc.send(JSON.stringify({...msg, ...(msg.data ? {data: Array.from(msg.data)} : {})}));
    }
}

export class Peer {
    public pc: RTCPeerConnection;
    public dc: RTCDataChannel | undefined;
    public uniqueId: string | undefined;

    constructor(private readonly worker: Worker) {
        this.pc = this.createConnection();
    }

    private createConnection(): RTCPeerConnection {
        const pc: RTCPeerConnection = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
        pc.ondatachannel = (event: RTCDataChannelEvent): void => {
            const dc: RTCDataChannel = event.channel;
            this.dc = dc;
            dc.onerror = dc.onclose = (): void => {
                if (this.dc !== dc) return;
                this.dc = undefined;
                this.uniqueId = undefined;
                this.worker.onerror?.(new ErrorEvent('error', {message: 'Browser host disconnected.'}));
                setPageStatus('The browser host disconnected. Select New user to join again.', true);
            };
            dc.onmessage = (message: MessageEvent): void => {
                try {
                    const msg: PeerMessage = JSON.parse(message.data);
                    if (msg.type === 'id') {
                        this.uniqueId = msg.id;
                        setPageStatus('Connected to the browser host. You can log in now.');
                    } else if (this.uniqueId) this.worker.onmessage?.(message);
                } catch {
                    dc.close();
                }
            };
        };
        return pc;
    }

    public async handleOffer(offer: string): Promise<void> {
        const remote: RTCSessionDescriptionInit = JSON.parse(offer);
        if (remote.type !== 'offer' || typeof remote.sdp !== 'string') throw new Error('Paste a valid host offer.');
        this.dc?.close();
        this.pc.close();
        this.uniqueId = undefined;
        this.dc = undefined;
        this.pc = this.createConnection();
        try {
            await this.pc.setRemoteDescription(remote);
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            if (!(await copyDescription(this.pc, 'answer'))) {
                this.pc.close();
                return;
            }
            setPageStatus('Send your answer to the host. Waiting for the connection…');
        } catch (error) {
            this.pc.close();
            throw error;
        }
    }
}
