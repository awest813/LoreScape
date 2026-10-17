/** @jest-environment jsdom */
import {Host, Peer} from '../src/js/jagex2/io/RTCDataChannels';
import {setPageStatus} from '../src/js/page-shell';
jest.mock('../src/js/page-shell', (): object => ({setPageStatus: jest.fn()}));

class FakeConnection extends EventTarget {
    static instances: FakeConnection[] = [];
    iceGatheringState: string = 'complete';
    connectionState: string = 'new';
    localDescription: RTCSessionDescriptionInit | null = null;
    onconnectionstatechange: (() => void) | null = null;
    ondatachannel: ((event: {channel: RTCDataChannel}) => void) | null = null;
    channel: RTCDataChannel = {readyState: 'open', send: jest.fn(), close: jest.fn()} as unknown as RTCDataChannel;
    close: jest.Mock = jest.fn();
    constructor() {
        super();
        FakeConnection.instances.push(this);
    }
    createDataChannel(): RTCDataChannel {
        return this.channel;
    }
    async createOffer(): Promise<RTCSessionDescriptionInit> {
        return {type: 'offer', sdp: 'offer-sdp'};
    }
    async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return {type: 'answer', sdp: 'answer-sdp'};
    }
    async setLocalDescription(value: RTCSessionDescriptionInit): Promise<void> {
        this.localDescription = value;
    }
    async setRemoteDescription(_value: RTCSessionDescriptionInit): Promise<void> {}
}
let worker: Worker;
let writeText: jest.Mock;
beforeEach((): void => {
    FakeConnection.instances = [];
    global.RTCPeerConnection = FakeConnection as unknown as typeof RTCPeerConnection;
    worker = {postMessage: jest.fn()} as unknown as Worker;
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    jest.spyOn(window, 'prompt').mockReturnValue(null);
});
afterEach((): void => {
    jest.restoreAllMocks();
});

test('an already gathered offer works and Cancel closes once without trapping the user', async (): Promise<void> => {
    await new Host(worker).setupPeerConnection();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({type: 'offer', sdp: 'offer-sdp'}));
    expect(window.prompt).toHaveBeenCalledTimes(1);
    expect(FakeConnection.instances[0].close).toHaveBeenCalledTimes(1);
});

test('clipboard refusal permits manual copy and cancellation', async (): Promise<void> => {
    writeText.mockRejectedValue(new Error('Clipboard denied'));
    await new Host(worker).setupPeerConnection();
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('Copy this offer'), expect.stringContaining('offer-sdp'));
    expect(FakeConnection.instances[0].close).toHaveBeenCalledTimes(1);
});

test('guest messages cannot impersonate the host connection and binary payloads survive JSON', async (): Promise<void> => {
    jest.mocked(window.prompt).mockReturnValue(JSON.stringify({type: 'answer', sdp: 'answer-sdp'}));
    const host: Host = new Host(worker);
    await host.setupPeerConnection();
    const dc: RTCDataChannel = FakeConnection.instances[0].channel;
    dc.onopen!(new Event('open'));
    const assigned: {id: string} = JSON.parse(String(jest.mocked(dc.send).mock.calls[0][0]));
    dc.onmessage!(new MessageEvent('message', {data: JSON.stringify({type: 'data', id: host.uniqueId, data: {0: 16, 1: 255}})}));
    expect(worker.postMessage).toHaveBeenLastCalledWith({type: 'data', id: assigned.id, data: [16, 255]});
    expect(assigned.id).not.toBe(host.uniqueId);
});

test('a guest may retry with a fresh connection after a failed invitation', async (): Promise<void> => {
    const peer: Peer = new Peer(worker);
    await expect(peer.handleOffer('{invalid')).rejects.toThrow();
    await peer.handleOffer(JSON.stringify({type: 'offer', sdp: 'valid-offer'}));
    expect(FakeConnection.instances).toHaveLength(2);
    expect(FakeConnection.instances[0].close).toHaveBeenCalled();
    expect(setPageStatus).toHaveBeenCalledWith(expect.stringContaining('Send your answer'));
});
