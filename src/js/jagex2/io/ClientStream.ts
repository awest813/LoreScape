import LinkList from '../datastruct/LinkList';
import Linkable from '../datastruct/Linkable';
import {socketUrl, validateSocketUrl} from '../../connection';

export type Socket = {
    host: string;
    port: number;
    urls?: string[];
};

export default class ClientStream {
    // constructor
    private readonly socket: WebSocket;
    private readonly wsin: WebSocketReader;
    private readonly wsout: WebSocketWriter;

    // runtime
    private closed: boolean = false;
    private ioerror: boolean = false;

    static openSocket = async (socket: Socket, timeoutMs: number = 10000): Promise<WebSocket> => {
        const securePage: boolean = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const urls: string[] = socket.urls?.length ? socket.urls.map((url: string): string => validateSocketUrl(url, securePage)) : [socketUrl(socket, securePage)];
        let lastError: unknown;
        for (const url of urls) {
            try {
                return await ClientStream.connect(url, timeoutMs);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    };

    private static connect = async (url: string, timeoutMs: number): Promise<WebSocket> => {
        return await new Promise<WebSocket>((resolve, reject): void => {
            const ws: WebSocket = new WebSocket(url, 'binary');
            ws.binaryType = 'arraybuffer';
            const cleanup = (): void => {
                clearTimeout(timeout);
                ws.removeEventListener('open', opened);
                ws.removeEventListener('error', failed);
                ws.removeEventListener('close', closed);
            };
            const fail = (message: string): void => {
                cleanup();
                if (ws.readyState !== WebSocket.CLOSED) ws.close();
                reject(new Error(message));
            };
            const opened = (): void => {
                cleanup();
                resolve(ws);
            };
            const failed = (): void => fail('Unable to open the game server connection.');
            const closed = (): void => fail('The game server closed before the connection was ready.');
            const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => fail('The game server connection timed out.'), timeoutMs);
            ws.addEventListener('open', opened);
            ws.addEventListener('error', failed);
            ws.addEventListener('close', closed);
        });
    };

    constructor(socket: WebSocket) {
        socket.onclose = this.onclose;
        socket.onerror = this.onerror;
        this.wsin = new WebSocketReader(socket, 5000);
        this.wsout = new WebSocketWriter(socket, 5000);
        this.socket = socket;
    }

    get host(): string {
        return new URL(this.socket.url).hostname;
    }

    get port(): number {
        const url: URL = new URL(this.socket.url);
        return Number(url.port || (url.protocol === 'wss:' ? 443 : 80));
    }

    get available(): number {
        return this.closed ? 0 : this.wsin.available;
    }

    write(src: Uint8Array, len: number): void {
        this.wsout.write(src, len);
    }

    private async withDeadline<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
        if (timeoutMs <= 0) return operation();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                operation(),
                new Promise<never>((_resolve, reject): void => {
                    timeout = setTimeout((): void => {
                        this.close();
                        reject(new Error('Timed out waiting for a response from the game server.'));
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
        }
    }

    async read(timeoutMs: number = 0): Promise<number> {
        return this.withDeadline(async (): Promise<number> => {
            if (this.closed) throw new Error('Game server connection is closed.');
            return this.wsin.fastByte() ?? (await this.wsin.slowByte());
        }, timeoutMs);
    }

    async readBytes(dst: Uint8Array, off: number, len: number, timeoutMs: number = 0): Promise<void> {
        return this.withDeadline(async (): Promise<void> => {
            if (this.closed) throw new Error('Game server connection is closed.');
            if (off < 0 || len < 0 || off + len > dst.length) throw new Error('Invalid read buffer range.');
            while (len > 0) {
                const read: Uint8Array = this.wsin.fastBytes(dst, off, len) ?? (await this.wsin.slowBytes(dst, off, len));
                if (read.length <= 0) throw new Error('EOF');
                off += read.length;
                len -= read.length;
            }
        }, timeoutMs);
    }

    close(): void {
        this.closed = true;
        this.socket.close();
        this.wsin.close();
        this.wsout.close();
        console.log('connection close!');
        if (this.ioerror) {
            console.log('connection error!');
        }
    }

    private onclose = (event: CloseEvent): void => {
        if (this.closed) {
            return;
        }
        this.close();
    };

    private onerror = (event: Event): void => {
        if (this.closed) {
            return;
        }
        this.ioerror = true;
        this.close();
    };
}

class WebSocketWriter {
    // constructor
    private readonly socket: WebSocket;
    private readonly limit: number;

    private closed: boolean = false;
    private ioerror: boolean = false;

    constructor(socket: WebSocket, limit: number) {
        this.socket = socket;
        this.limit = limit;
    }

    write(src: Uint8Array, len: number): void {
        if (this.closed) {
            return;
        }
        if (this.ioerror) {
            this.ioerror = false;
            throw new Error('Error in writer thread');
        }
        if (len > this.limit || src.length > this.limit) {
            throw new Error('buffer overflow');
        }
        try {
            this.socket.send(src.subarray(0, len));
        } catch (e) {
            this.ioerror = true;
        }
    }

    close(): void {
        this.closed = true;
    }
}

class WebSocketEvent extends Linkable {
    private readonly bytes: Uint8Array;
    private position: number;

    constructor(bytes: Uint8Array) {
        super();
        this.bytes = bytes;
        this.position = 0;
    }

    get available(): number {
        return this.bytes.length - this.position;
    }

    get read(): number {
        return this.bytes[this.position++];
    }

    get len(): number {
        return this.bytes.length;
    }
}

class WebSocketReader {
    // constructor
    private readonly limit: number;

    // runtime
    private queue: LinkList = new LinkList();
    private event: WebSocketEvent | null = null;
    private callback: ((data: WebSocketEvent | null) => void) | null = null;
    private total: number = 0;
    private closed: boolean = false;

    constructor(socket: WebSocket, limit: number) {
        this.limit = limit;
        socket.binaryType = 'arraybuffer';
        socket.onmessage = this.onmessage;
    }

    get available(): number {
        return this.total;
    }

    private onmessage = (e: MessageEvent): void => {
        if (this.closed) return;
        const event: WebSocketEvent = new WebSocketEvent(new Uint8Array(e.data));
        if (this.event) {
            this.queue.addTail(event);
        } else {
            this.event = event;
        }
        this.total += event.len;
        if (!this.callback) {
            return;
        }
        this.callback(this.event);
        this.callback = null;
        // check for the overflow after the callback
        if (this.total > this.limit) {
            throw new Error('buffer overflow');
        }
    };

    private readFastByte(): number | null {
        if (this.event && this.event.available > 0) {
            return this.event.read;
        }
        return null;
    }

    private async readSlowByte(): Promise<number> {
        while (!this.closed) {
            const byte: number | null = this.readFastByte();
            if (byte !== null) return byte;
            this.event = this.queue.removeHead() as WebSocketEvent | null;
            if (this.event) continue;
            await new Promise<void>((resolve): void => {
                this.callback = (): void => resolve();
            });
        }
        throw new Error('WebSocketReader closed while reading.');
    }

    fastBytes(dst: Uint8Array, off: number, len: number): Uint8Array | null {
        if (this.closed) {
            throw new Error('WebSocketReader is closed!');
        }
        if (!(this.event && this.event.available >= len)) {
            return null;
        }
        while (len > 0) {
            const fast: number | null = this.readFastByte();
            if (fast === null) {
                throw new Error('EOF - tried to read a fast byte when there was not enough immediate bytes.');
            }
            dst[off++] = fast;
            this.total--;
            len--;
        }
        return dst;
    }

    async slowBytes(dst: Uint8Array, off: number, len: number): Promise<Uint8Array> {
        if (this.closed) {
            throw new Error('WebSocketReader is closed!');
        }
        while (len > 0) {
            dst[off++] = this.readFastByte() ?? (await this.readSlowByte());
            this.total--;
            len--;
        }
        return dst;
    }

    fastByte(): number | null {
        if (this.closed) {
            throw new Error('WebSocketReader is closed!');
        }
        const fast: number | null = this.readFastByte();
        if (fast === null) {
            return null;
        }
        this.total--;
        return fast;
    }

    async slowByte(): Promise<number> {
        if (this.closed) {
            throw new Error('WebSocketReader is closed!');
        }
        const slow: number = await this.readSlowByte();
        this.total--;
        return slow;
    }

    close(): void {
        this.closed = true;
        const pending: ((data: WebSocketEvent | null) => void) | null = this.callback;
        this.callback = null;
        pending?.(null);
        this.total = 0;
        this.event = null;
        this.queue.clear();
    }
}
