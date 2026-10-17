import {downloadText, downloadUrl} from '../src/js/jagex2/util/JsUtil';

afterEach((): void => {
    jest.restoreAllMocks();
});

test('HTTP failures are rejected before reading archive bytes', async (): Promise<void> => {
    const body: jest.Mock = jest.fn();
    jest.spyOn(global, 'fetch').mockResolvedValue({ok: false, status: 404, arrayBuffer: body} as unknown as Response);
    await expect(downloadUrl('/missing')).rejects.toThrow('404');
    expect(body).not.toHaveBeenCalled();
});

test('downloads abort stalled requests', async (): Promise<void> => {
    jest.spyOn(global, 'fetch').mockImplementation(
        (_url, options): Promise<Response> =>
            new Promise((_resolve, reject): void => {
                options?.signal?.addEventListener('abort', (): void => reject(new Error('aborted')));
            })
    );
    await expect(downloadText('/stalled', 10)).rejects.toThrow('aborted');
});

test('binary and text downloads preserve their contents', async (): Promise<void> => {
    jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ok: true, arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([0, 127, 255]).buffer} as Response)
        .mockResolvedValueOnce({ok: true, text: async (): Promise<string> => 'worlds'} as Response);
    expect(await downloadUrl('/archive')).toEqual(new Int8Array([0, 127, -1]));
    expect(await downloadText('/text')).toBe('worlds');
});

test('a caller can cancel a pending binary download', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    jest.spyOn(global, 'fetch').mockImplementation(
        (_url, options): Promise<Response> =>
            new Promise((_resolve, reject): void => {
                options?.signal?.addEventListener('abort', (): void => reject(new Error('caller cancelled')));
            })
    );
    const downloading: Promise<Int8Array> = downloadUrl('/pending', 10000, controller.signal);
    controller.abort();
    await expect(downloading).rejects.toThrow('caller cancelled');
});

test('an already cancelled request never starts a usable download', async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    controller.abort();
    const fetcher: jest.SpyInstance = jest.spyOn(global, 'fetch').mockImplementation((_url, options): Promise<Response> => {
        expect(options?.signal?.aborted).toBe(true);
        return Promise.reject(new Error('already cancelled'));
    });
    await expect(downloadText('/cancelled', 10000, controller.signal)).rejects.toThrow('already cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1);
});
