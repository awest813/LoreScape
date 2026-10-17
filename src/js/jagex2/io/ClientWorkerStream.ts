type WorkerMessage = {type: string; data?: Uint8Array | number[]; id?: string};

export default class ClientWorkerStream {
    public readonly wwin: WorkerReader;
    private closed: boolean = false;

    constructor(
        private readonly worker: Worker,
        private readonly uniqueId: string
    ) {
        this.wwin = new WorkerReader(5000);
        worker.onerror = (): void => this.close();
        worker.onmessageerror = (): void => this.close();
        worker.postMessage({type: 'connection', id: uniqueId});
    }

    get available(): number {
        return this.closed ? 0 : this.wwin.available;
    }

    write(src: Uint8Array, len: number): void {
        if (this.closed) throw new Error('Local server connection is closed.');
        if (!Number.isInteger(len) || len < 0 || len > src.length || len > 5000) throw new Error('Invalid worker write buffer.');
        this.worker.postMessage({type: 'data', data: src.slice(0, len), id: this.uniqueId});
    }

    private async withDeadline<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
        if (timeoutMs <= 0) return operation();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                operation(),
                new Promise<never>((_resolve, reject): void => {
                    timer = setTimeout((): void => {
                        reject(new Error('Timed out waiting for the local server. Check the worker or peer connection.'));
                        this.close();
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    async read(timeoutMs: number = 0): Promise<number> {
        return this.withDeadline((): Promise<number> => this.wwin.read(), timeoutMs);
    }

    async readBytes(dst: Uint8Array, off: number, len: number, timeoutMs: number = 0): Promise<void> {
        if (!Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 0 || off + len > dst.length) throw new Error('Invalid read buffer range.');
        await this.withDeadline(async (): Promise<void> => {
            for (let index: number = 0; index < len; index++) dst[off + index] = await this.wwin.read();
        }, timeoutMs);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.wwin.close();
        try {
            this.worker.postMessage({type: 'close', id: this.uniqueId});
        } catch {
            /* The worker or peer may already be disconnected. */
        }
    }
}

class WorkerReader {
    private chunks: Uint8Array[] = [];
    private position: number = 0;
    private total: number = 0;
    private closed: boolean = false;
    private wake: (() => void) | undefined;

    constructor(private readonly limit: number) {}

    get available(): number {
        return this.total;
    }

    public onmessage = (event: MessageEvent | WorkerMessage): void => {
        if (this.closed) return;
        // Browser workers deliver MessageEvents; the host also forwards raw messages.
        const payload: unknown = 'type' in event && ['data', 'close'].includes(event.type) ? event : event.data;
        const message: WorkerMessage = typeof payload === 'string' ? JSON.parse(payload) : (payload as WorkerMessage);
        if (message?.type === 'close') {
            this.close();
            return;
        }
        if (message?.type !== 'data' || !message.data) return;
        const bytes: Uint8Array = new Uint8Array(message.data);
        if (this.total + bytes.length > this.limit) {
            this.close();
            return;
        }
        if (bytes.length) {
            this.chunks.push(bytes);
            this.total += bytes.length;
        }
        this.wake?.();
        this.wake = undefined;
    };

    async read(): Promise<number> {
        while (!this.closed) {
            const chunk: Uint8Array | undefined = this.chunks[0];
            if (chunk) {
                const byte: number = chunk[this.position++];
                this.total--;
                if (this.position === chunk.length) {
                    this.chunks.shift();
                    this.position = 0;
                }
                return byte;
            }
            await new Promise<void>((resolve): void => {
                this.wake = resolve;
            });
        }
        throw new Error('Local server connection closed while reading.');
    }

    close(): void {
        this.closed = true;
        this.chunks = [];
        this.position = 0;
        this.total = 0;
        this.wake?.();
        this.wake = undefined;
    }
}
