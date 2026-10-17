import Database from '../src/js/jagex2/io/Database';

let request: IDBOpenDBRequest;
beforeEach((): void => {
    request = {} as IDBOpenDBRequest;
    Object.defineProperty(global, 'indexedDB', {configurable: true, value: {open: jest.fn((): IDBOpenDBRequest => request)}});
});
afterEach((): void => {
    jest.useRealTimers();
    delete (global as {indexedDB?: IDBFactory}).indexedDB;
});

test('optional tool storage still imports and reads caches when site storage is blocked', async (): Promise<void> => {
    Object.defineProperty(global, 'indexedDB', {configurable: true, get: (): never => { throw new Error('Storage blocked by policy'); }});
    const cache: Database = await Database.openOptional();
    expect(cache.persistent).toBe(false);
    await expect(cache.cachesaveMany([
        {name: 'main_file_cache.dat', bytes: new Uint8Array([1, 2, 255])},
        {name: 'main_file_cache.idx0', bytes: new Uint8Array([3, 4])}
    ])).resolves.toBe(true);
    expect(await cache.cacheload('main_file_cache.dat')).toEqual(new Int8Array([1, 2, -1]));
    const reloaded: Database = await Database.openOptional();
    expect(await reloaded.cacheload('main_file_cache.dat')).toBeUndefined();
});

test('session cache keeps private copies so editing a buffer cannot corrupt stored files', async (): Promise<void> => {
    const cache: Database = new Database(null);
    const source: Int8Array = new Int8Array([1, 2]);
    await cache.cachesave('model', source);
    source[0] = 9;
    const loaded: Int8Array = (await cache.cacheload('model'))!;
    expect(loaded[0]).toBe(1);
    loaded[0] = 8;
    expect((await cache.cacheload('model'))![0]).toBe(1);
});

test('a stalled cache open times out and closes a connection that arrives late', async (): Promise<void> => {
    jest.useFakeTimers();
    const opening: Promise<IDBDatabase> = Database.openDatabase(50);
    const rejected: Promise<void> = expect(opening).rejects.toThrow('timed out');
    jest.advanceTimersByTime(50);
    await rejected;
    const db: IDBDatabase = {close: jest.fn()} as unknown as IDBDatabase;
    Object.defineProperty(request, 'result', {value: db});
    request.onsuccess!(new Event('success'));
    expect(db.close).toHaveBeenCalledTimes(1);
});

test('blocked cache does not leave startup pending', async (): Promise<void> => {
    const opening: Promise<IDBDatabase> = Database.openDatabase();
    request.onblocked!(new Event('blocked') as IDBVersionChangeEvent);
    await expect(opening).rejects.toThrow('blocked');
});

test('closed storage becomes a cache miss and subsequent writes resolve safely', async (): Promise<void> => {
    const db: IDBDatabase = {
        transaction: jest.fn((): never => {
            throw new Error('Database closed');
        })
    } as unknown as IDBDatabase;
    const cache: Database = new Database(db);
    await expect(cache.cacheload('title')).resolves.toBeUndefined();
    await expect(cache.cachesave('title', new Int8Array([1]))).resolves.toBe(false);
    expect(db.transaction).toHaveBeenCalledTimes(1);
});

test('an aborted transaction cannot leave a map save pending or reject an unawaited save', async (): Promise<void> => {
    const tx: IDBTransaction = {objectStore: (): object => ({put: (): object => ({})})} as unknown as IDBTransaction;
    const cache: Database = new Database({transaction: (): IDBTransaction => tx} as unknown as IDBDatabase);
    const saving: Promise<boolean> = cache.cachesave('m50_50', new Int8Array([1, 2]));
    tx.onabort!(new Event('abort'));
    await expect(saving).resolves.toBe(false);
});

test('successful writes wait for transaction commit', async (): Promise<void> => {
    const put: IDBRequest<IDBValidKey> = {result: 'title'} as IDBRequest<IDBValidKey>;
    const tx: IDBTransaction = {objectStore: (): object => ({put: (): IDBRequest<IDBValidKey> => put})} as unknown as IDBTransaction;
    const cache: Database = new Database({transaction: (): IDBTransaction => tx} as unknown as IDBDatabase);
    let committed: boolean = false;
    const saving: Promise<void> = cache.cachesave('title', new Int8Array([1])).then((): void => {
        committed = true;
    });
    put.onsuccess!(new Event('success'));
    await Promise.resolve();
    expect(committed).toBe(false);
    tx.oncomplete!(new Event('complete'));
    await saving;
    expect(committed).toBe(true);
});

test('a bundle write error aborts the whole transaction and resolves false', async (): Promise<void> => {
    const abort: jest.Mock = jest.fn();
    const put: jest.Mock = jest
        .fn()
        .mockReturnValueOnce({})
        .mockImplementationOnce((): never => {
            throw new Error('Quota exceeded');
        });
    const tx: IDBTransaction = {objectStore: (): object => ({put, transaction: {abort}})} as unknown as IDBTransaction;
    const cache: Database = new Database({transaction: (): IDBTransaction => tx} as unknown as IDBDatabase);
    await expect(
        cache.cachesaveMany([
            {name: 'main_file_cache.dat', bytes: new Uint8Array([1])},
            {name: 'main_file_cache.idx0', bytes: new Uint8Array([2])}
        ])
    ).resolves.toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
});
