export default class Database {
    private readonly db: IDBDatabase;

    constructor(db: IDBDatabase) {
        db.onerror = this.onerror;
        db.onclose = this.onclose;
        db.onversionchange = (): void => db.close();
        this.db = db;
    }

    static openDatabase = async (): Promise<IDBDatabase> => {
        return await new Promise<IDBDatabase>((resolve, reject): void => {
            const request: IDBOpenDBRequest = indexedDB.open('lostcity', 1);

            request.onsuccess = (event: Event): void => {
                const target: IDBOpenDBRequest = event.target as IDBOpenDBRequest;
                console.log('database success!');
                resolve(target.result);
            };

            request.onupgradeneeded = (event: Event): void => {
                const target: IDBOpenDBRequest = event.target as IDBOpenDBRequest;
                target.result.createObjectStore('cache');
            };

            request.onerror = (event: Event): void => {
                const target: IDBOpenDBRequest = event.target as IDBOpenDBRequest;
                console.error('database error!: ', target.error);
                reject(target.result);
            };
        });
    };

    // This database only caches rebuildable assets; failure must not prevent play.
    cacheload = async (name: string): Promise<Int8Array | undefined> => {
        return await new Promise<Int8Array | undefined>((resolve): void => {
            try {
                const request: IDBRequest<Int8Array> = this.db.transaction('cache', 'readonly').objectStore('cache').get(name);
                request.onsuccess = (): void => resolve(request.result);
                request.onerror = (): void => resolve(undefined);
            } catch {
                resolve(undefined);
            }
        });
    };

    cachesave = async (name: string, src: Int8Array): Promise<void> => {
        return await new Promise<void>((resolve): void => {
            try {
                const transaction: IDBTransaction = this.db.transaction('cache', 'readwrite');
                transaction.objectStore('cache').put(src, name);
                transaction.oncomplete = (): void => resolve();
                transaction.onerror = transaction.onabort = (): void => resolve();
            } catch {
                resolve();
            }
        });
    };

    private onclose = (event: Event): void => {
        console.log('database close!');
    };

    private onerror = (event: Event): void => {
        console.log('database error!');
    };

    private genHash = (str: string): number => {
        const trimmed: string = str.trim();
        let hash: number = 0;
        for (let i: number = 0; i < trimmed.length && i < 12; i++) {
            const c: string = trimmed.charAt(i);
            hash *= 37;

            if (c >= 'A' && c <= 'Z') {
                hash += c.charCodeAt(0) + 1 - 65;
            } else if (c >= 'a' && c <= 'z') {
                hash += c.charCodeAt(0) + 1 - 97;
            } else if (c >= '0' && c <= '9') {
                hash += c.charCodeAt(0) + 27 - 48;
            }
        }
        return hash;
    };
}
