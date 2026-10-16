import {getWorldInfo, WorldInfo} from '../src/js/worldlist';
import {downloadText, sleep} from '../src/js/jagex2/util/JsUtil';

jest.mock('../src/js/jagex2/util/JsUtil', (): object => ({downloadText: jest.fn(), sleep: jest.fn()}));
const world: WorldInfo = {id: 1, address: 'https://world.example:43595', region: 'Test', portOffset: 1, players: 0};
beforeEach((): void => {
    jest.resetAllMocks();
});

test('finds the requested world and uses HTTPS', async (): Promise<void> => {
    jest.mocked(downloadText).mockResolvedValue(JSON.stringify([world]));
    expect(await getWorldInfo(true, 1)).toEqual(world);
    expect(downloadText).toHaveBeenCalledWith('https://2004scape.org/api/v1/worldlist', 10000);
});

test('stops after three failed world-list requests', async (): Promise<void> => {
    jest.mocked(downloadText).mockRejectedValue(new Error('offline'));
    await expect(getWorldInfo(true, 1)).rejects.toThrow('unavailable');
    expect(downloadText).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
});

test('reports a missing world without retrying the list', async (): Promise<void> => {
    jest.mocked(downloadText).mockResolvedValue(JSON.stringify([world]));
    await expect(getWorldInfo(true, 2)).rejects.toThrow('World 2 is unavailable');
    expect(downloadText).toHaveBeenCalledTimes(1);
});

test.each([-1, NaN, 1.5, 998])('rejects an invalid live world %s', async (id: number): Promise<void> => {
    await expect(getWorldInfo(true, id)).rejects.toThrow('valid world');
    expect(downloadText).not.toHaveBeenCalled();
});

test.each(['http://world.example', 'javascript:alert(1)'])('rejects an incompatible secure-world address %s', async (address: string): Promise<void> => {
    jest.mocked(downloadText).mockResolvedValue(JSON.stringify([{...world, address}]));
    await expect(getWorldInfo(true, 1)).rejects.toThrow('compatible connection');
});

test('rejects malformed world-list responses with bounded retries', async (): Promise<void> => {
    jest.mocked(downloadText).mockResolvedValue('{}');
    await expect(getWorldInfo(true, 1)).rejects.toThrow('unavailable');
    expect(downloadText).toHaveBeenCalledTimes(3);
});
