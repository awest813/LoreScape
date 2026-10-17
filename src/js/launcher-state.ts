import {localWorldAddresses} from './connection';
import type {WorldInfo} from './worldlist';

export type LauncherPreferences = {world: number; detail: 'high' | 'low'; localAddress?: string};
export const defaultPreferences: LauncherPreferences = {world: 1, detail: 'high'};

export function validWorld(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999;
}

export function parsePreferences(saved: string | null): LauncherPreferences {
    try {
        const value: unknown = JSON.parse(saved || 'null');
        if (!value || typeof value !== 'object') return {...defaultPreferences};
        const record: Record<string, unknown> = value as Record<string, unknown>;
        const preferences: LauncherPreferences = {world: validWorld(record.world) ? record.world : 1, detail: record.detail === 'low' ? 'low' : 'high'};
        if (typeof record.localAddress === 'string') {
            try {
                preferences.localAddress = localWorldAddresses(record.localAddress, false).files;
            } catch {
                /* Ignore invalid saved addresses. */
            }
        }
        return preferences;
    } catch {
        return {...defaultPreferences};
    }
}

export function parseWorldChoices(value: unknown): WorldInfo[] {
    if (!Array.isArray(value)) throw new Error('The world directory returned an invalid response.');
    const seen: Set<number> = new Set();
    return value
        .filter((entry: unknown): entry is WorldInfo => {
            if (!entry || typeof entry !== 'object') return false;
            const world: Record<string, unknown> = entry as Record<string, unknown>;
            if (
                !validWorld(world.id) ||
                world.id < 1 ||
                world.id > 997 ||
                seen.has(world.id) ||
                typeof world.region !== 'string' ||
                typeof world.address !== 'string' ||
                !Number.isInteger(world.portOffset) ||
                (world.members !== undefined && typeof world.members !== 'boolean') ||
                typeof world.players !== 'number' ||
                !Number.isInteger(world.players) ||
                world.players < 0
            )
                return false;
            try {
                if (!['http:', 'https:'].includes(new URL(world.address).protocol)) return false;
            } catch {
                return false;
            }
            seen.add(world.id);
            return true;
        })
        .sort((a: WorldInfo, b: WorldInfo): number => a.id - b.id);
}
