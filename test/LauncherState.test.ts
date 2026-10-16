import type {WorldInfo} from '../src/js/worldlist';
import {defaultPreferences, parsePreferences, parseWorldChoices, validWorld} from '../src/js/launcher-state';

const world: object = {id: 2, region: 'Test region', address: 'https://world.example', portOffset: 1, players: 42, members: true};

test.each([null, 'broken json', 'null', '[]', '42'])('defaults safely for missing or invalid saved preferences: %s', (saved: string | null): void => {
    expect(parsePreferences(saved)).toEqual(defaultPreferences);
});

test('restores supported settings and ignores unknown fields', (): void => {
    expect(parsePreferences('{"world":2,"detail":"low","other":"ignored"}')).toEqual({world: 2, detail: 'low'});
});

test.each([-1, 1000, 2.5, '2', null])('rejects invalid saved world values: %s', (worldId: unknown): void => {
    expect(parsePreferences(JSON.stringify({world: worldId, detail: 'unexpected'}))).toEqual(defaultPreferences);
});

test.each([0, 1, 997, 998, 999])('supports live and advanced world IDs: %s', (id: number): void => {
    expect(validWorld(id)).toBe(true);
});

test('world directory is sorted, deduplicated, and validated', (): void => {
    expect(parseWorldChoices([world, {...world, id: 1}, world, null, {...world, id: 0}, {...world, id: 998}, {...world, players: -1}, {...world, address: 'javascript:alert(1)'}]).map((entry: WorldInfo): number => entry.id)).toEqual([1, 2]);
});

test('directory rejects non-array responses', (): void => {
    expect((): WorldInfo[] => parseWorldChoices({worlds: []})).toThrow('invalid response');
});
