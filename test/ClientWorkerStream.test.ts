import ClientWorkerStream from '../src/js/jagex2/io/ClientWorkerStream';

let stream: ClientWorkerStream;
let postMessage: jest.Mock;
beforeEach((): void => {
    postMessage = jest.fn();
    stream = new ClientWorkerStream({postMessage} as unknown as Worker, 'player-1');
});
afterEach((): void => {
    stream.close();
});

test('receives fragmented worker MessageEvents and raw host messages in order', async (): Promise<void> => {
    const seed: Uint8Array = new Uint8Array(8);
    const reading: Promise<void> = stream.readBytes(seed, 0, 8, 500);
    stream.wwin.onmessage(new MessageEvent('message', {data: {type: 'data', data: new Uint8Array([0, 0, 0]), id: 'player-1'}}));
    stream.wwin.onmessage({type: 'data', data: [1, 0, 0, 0, 2]});
    await reading;
    expect([...seed]).toEqual([0, 0, 0, 1, 0, 0, 0, 2]);
    expect(stream.available).toBe(0);
});

test('normalizes peer JSON messages and reads a rejection after sending a login packet', async (): Promise<void> => {
    expect(postMessage).toHaveBeenCalledWith({type: 'connection', id: 'player-1'});
    stream.write(new Uint8Array([16, 1, 225, 0]), 3);
    expect(postMessage).toHaveBeenCalledWith({type: 'data', data: new Uint8Array([16, 1, 225]), id: 'player-1'});
    stream.wwin.onmessage(new MessageEvent('message', {data: JSON.stringify({type: 'data', data: [3]})}));
    expect(await stream.read(100)).toBe(3);
});

test('disconnect wakes a pending read immediately and tells the worker to close', async (): Promise<void> => {
    const reading: Promise<number> = stream.read();
    stream.close();
    await expect(reading).rejects.toThrow('closed');
    expect(postMessage).toHaveBeenLastCalledWith({type: 'close', id: 'player-1'});
    expect((): void => stream.write(new Uint8Array([16]), 1)).toThrow('closed');
});

test('remote close rejects pending reads without polling', async (): Promise<void> => {
    const reading: Promise<number> = stream.read();
    stream.wwin.onmessage({type: 'close'});
    await expect(reading).rejects.toThrow('closed');
});

test('stalled worker handshake times out rather than hanging login', async (): Promise<void> => {
    await expect(stream.readBytes(new Uint8Array(8), 0, 8, 10)).rejects.toThrow('Timed out');
    await expect(stream.read()).rejects.toThrow('closed');
});

test('buffer overflow closes the reader and wakes pending reads', async (): Promise<void> => {
    const reading: Promise<number> = stream.read();
    stream.wwin.onmessage({type: 'data', data: new Uint8Array(5001)});
    await expect(reading).rejects.toThrow('closed');
});

test('queues an initial world burst spanning several protocol frames', async (): Promise<void> => {
    const first: Uint8Array = new Uint8Array(5000).fill(17);
    const second: Uint8Array = new Uint8Array(5000).fill(29);
    stream.wwin.onmessage({type: 'data', data: first});
    stream.wwin.onmessage({type: 'data', data: second});
    expect(stream.available).toBe(10000);
    const received: Uint8Array = new Uint8Array(10000);
    await stream.readBytes(received, 0, received.length, 500);
    expect(received.subarray(0, 5000)).toEqual(first);
    expect(received.subarray(5000)).toEqual(second);
    expect(stream.available).toBe(0);
});

test('bounds the combined worker receive queue', async (): Promise<void> => {
    for (let i: number = 0; i < 210; i++) stream.wwin.onmessage({type: 'data', data: new Uint8Array(5000)});
    await expect(stream.read()).rejects.toThrow('closed');
});
