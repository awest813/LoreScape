import {fetchJsonWithTimeout} from '../src/js/fetch-timeout';

beforeEach((): void => {
    jest.useFakeTimers();
});
afterEach((): void => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test('works without AbortSignal.timeout and clears its timer', async (): Promise<void> => {
    jest.spyOn(AbortSignal, 'timeout').mockImplementation((): AbortSignal => {
        throw new Error('unsupported');
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ok: true, json: async (): Promise<unknown> => ({version: 1})} as Response);
    await expect(fetchJsonWithTimeout('/config', 10000)).resolves.toEqual({version: 1});
    expect(jest.getTimerCount()).toBe(0);
});

test('aborts a stalled body as well as a stalled connection', async (): Promise<void> => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(
        async (_url, options): Promise<Response> =>
            ({
                ok: true,
                json: (): Promise<unknown> =>
                    new Promise((_resolve, reject): void => {
                        options!.signal!.addEventListener('abort', (): void => reject(new Error('aborted')));
                    })
            }) as Response
    );
    const pending: Promise<unknown> = fetchJsonWithTimeout('/config', 10000);
    const rejected: Promise<void> = expect(pending).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
});

test('HTTP failures release the timer', async (): Promise<void> => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ok: false} as Response);
    await expect(fetchJsonWithTimeout('/config', 10000)).rejects.toThrow('login configuration');
    expect(jest.getTimerCount()).toBe(0);
});
