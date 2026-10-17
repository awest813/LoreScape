/** @jest-environment jsdom */
import {Host, Peer} from '../src/js/jagex2/io/CoopDataChannels';

const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(global, 'RTCPeerConnection');
let send: jest.Mock;
let worker: Worker;
function prepare(mode: string): void {
    send = jest.fn();
    worker = {postMessage: jest.fn(), onmessage: jest.fn()} as unknown as Worker;
    Object.defineProperty(window, 'LoreCoop', {configurable: true, value: {id: 'player-1', iceServers: [], transportMode: mode, send, attachTransport: jest.fn(), notify: jest.fn()}});
}
afterEach((): void => {
    if (original) Object.defineProperty(global, 'RTCPeerConnection', original);
    else Reflect.deleteProperty(global, 'RTCPeerConnection');
    Reflect.deleteProperty(window, 'LoreCoop');
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test.each(['relay', 'auto'])('%s connects with relay when WebRTC is unavailable', (mode: string): void => {
    prepare(mode);
    Object.defineProperty(global, 'RTCPeerConnection', {configurable: true, value: undefined});
    const peer: Peer = new Peer(worker);
    expect(send).toHaveBeenCalledWith({type: 'ready', relay: true});
    peer.signal({type: 'relay-open', id: 'player-1'});
    expect(peer.uniqueId).toBe('player-1');
    peer.dc!.send(JSON.stringify({type: 'connection'}));
    expect(send).toHaveBeenLastCalledWith({type: 'relay', message: {type: 'connection'}});
    peer.signal({type: 'relay', id: 'player-1', message: {type: 'data', data: [0, 255]}});
    expect(worker.onmessage).toHaveBeenCalled();
    peer.dispose();
});

test('automatic mode falls back when a device policy rejects RTC construction', (): void => {
    prepare('auto');
    Object.defineProperty(global, 'RTCPeerConnection', {
        configurable: true,
        value: jest.fn((): never => {
            throw new DOMException('Blocked by policy', 'SecurityError');
        })
    });
    const peer: Peer = new Peer(worker);
    expect(send).toHaveBeenCalledWith({type: 'ready', relay: true});
    peer.dispose();
});

test('RTC-only mode reports how to recover when RTC is unavailable', (): void => {
    prepare('rtc');
    Object.defineProperty(global, 'RTCPeerConnection', {configurable: true, value: undefined});
    expect((): Peer => new Peer(worker)).toThrow('Relay');
    expect(send).not.toHaveBeenCalled();
});

test('a host without RTC offers relay to an automatic guest', (): void => {
    prepare('auto');
    Object.defineProperty(global, 'RTCPeerConnection', {configurable: true, value: undefined});
    const host: Host = new Host(worker);
    host.onWorkerReady();
    host.signal({type: 'guest-reserved', id: 'guest-1'});
    host.signal({type: 'guest-ready', id: 'guest-1'});
    expect(send).toHaveBeenCalledWith({type: 'relay-open', to: 'guest-1'});
    host.dispose();
});

test('RTC-only selection never silently switches to relay', (): void => {
    prepare('rtc');
    Object.defineProperty(global, 'RTCPeerConnection', {configurable: true, value: jest.fn((): object => ({close: jest.fn()}))});
    const peer: Peer = new Peer(worker);
    expect(send).toHaveBeenCalledWith({type: 'ready', relay: false});
    peer.signal({type: 'relay-open', id: 'player-1'});
    expect(send).toHaveBeenLastCalledWith({type: 'leave'});
    expect(peer.uniqueId).toBeUndefined();
    expect(peer.dc).toBeUndefined();
    peer.dispose();
});

test('stalled RTC-only joining provides recovery guidance after a bounded wait', (): void => {
    jest.useFakeTimers();
    prepare('rtc');
    const notify: jest.Mock = (window as unknown as {LoreCoop: {notify: jest.Mock}}).LoreCoop.notify;
    Object.defineProperty(global, 'RTCPeerConnection', {configurable: true, value: jest.fn((): object => ({close: jest.fn()}))});
    const peer: Peer = new Peer(worker);
    jest.advanceTimersByTime(30000);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Automatic or Relay'), true);
    expect(send).not.toHaveBeenCalledWith({type: 'relay-open'});
    peer.dispose();
});
