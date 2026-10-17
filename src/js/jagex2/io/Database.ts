export default class Database {
    private available: boolean = true;
    readonly persistent: boolean;
    private readonly memory: Map<string, Int8Array> | null;

    constructor(private readonly db: IDBDatabase | null) {
        this.persistent = db !== null;
        this.memory = db ? null : new Map();
        if (!db) return;
        db.onclose = (): void => {
            this.available = false;
        };
        db.onversionchange = (): void => {
            this.available = false;
            db.close();
        };
    }

    static async openOptional(): Promise<Database> {
        try {
            return new Database(await Database.openDatabase());
        } catch {
            return new Database(null);
        }
    }

    static async openDatabase(timeoutMs: number = 5000): Promise<IDBDatabase> {
        return new Promise<IDBDatabase>((resolve, reject): void => {
            let settled: boolean = false;
            const request: IDBOpenDBRequest = indexedDB.open('lostcity', 1);
            const fail = (error: Error | DOMException): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            };
            const timer: ReturnType<typeof setTimeout> = setTimeout((): void => fail(new Error('Browser cache timed out.')), timeoutMs);
            request.onsuccess = (): void => {
                clearTimeout(timer);
                if (settled) {
                    request.result.close();
                    return;
                }
                settled = true;
                resolve(request.result);
            };
            request.onupgradeneeded = (): void => {
                if (!request.result.objectStoreNames.contains('cache')) request.result.createObjectStore('cache');
            };
            request.onblocked = (): void => fail(new Error('Browser cache is blocked by another open client.'));
            request.onerror = (): void => fail(request.error || new Error('Browser cache unavailable.'));
        });
    }

    cacheload = async (name: string): Promise<Int8Array | undefined> => {
        if (this.memory) return this.memory.get(name)?.slice();
        return this.transaction<Int8Array>('readonly', (store: IDBObjectStore): IDBRequest<Int8Array> => store.get(name));
    };

    cachesave = async (name: string, src: Int8Array): Promise<boolean> => {
        if (this.memory) {
            this.memory.set(name, src.slice());
            return true;
        }
        const key: IDBValidKey | undefined = await this.transaction<IDBValidKey>('readwrite', (store: IDBObjectStore): IDBRequest<IDBValidKey> => store.put(src, name));
        return key !== undefined;
    };

    cachesaveMany = async (files: {name: string; bytes: Uint8Array}[]): Promise<boolean> => {
        if (this.memory) {
            const copies: {name: string; bytes: Int8Array}[] = files.map((file): {name: string; bytes: Int8Array} => ({name: file.name, bytes: new Int8Array(file.bytes)}));
            for (const file of copies) this.memory.set(file.name, file.bytes);
            return true;
        }
        if (!files.length) return true;
        const key: IDBValidKey | undefined = await this.transaction<IDBValidKey>('readwrite', (store: IDBObjectStore): IDBRequest<IDBValidKey> => {
            try {
                let last: IDBRequest<IDBValidKey> = store.put(new Int8Array(files[0].bytes), files[0].name);
                for (const file of files.slice(1)) last = store.put(new Int8Array(file.bytes), file.name);
                return last;
            } catch (error) {
                store.transaction.abort();
                throw error;
            }
        });
        return key !== undefined;
    };

    // Cache failures must not interrupt startup, map downloads, or unawaited saves.
    private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
        if (!this.available || !this.db) return undefined;
        const db: IDBDatabase = this.db;
        return new Promise<T | undefined>((resolve): void => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = (value?: T, failed: boolean = false): void => {
                if (timer !== undefined) clearTimeout(timer);
                if (failed) this.available = false;
                resolve(value);
            };
            try {
                const transaction: IDBTransaction = db.transaction('cache', mode);
                const request: IDBRequest<T> = action(transaction.objectStore('cache'));
                let value: T | undefined;
                request.onsuccess = (): void => {
                    value = request.result;
                };
                transaction.oncomplete = (): void => finish(value);
                transaction.onabort = transaction.onerror = (): void => finish(undefined, true);
                timer = setTimeout((): void => {
                    finish(undefined, true);
                    try {
                        transaction.abort();
                    } catch {
                        /* Already inactive. */
                    }
                }, 5000);
            } catch {
                finish(undefined, true);
            }
        });
    }
}
