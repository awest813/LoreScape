export const MAX_PLAYERS = 4;
export const DEFAULT_SETTINGS = Object.freeze({xpRate: 1, lootRate: 1, lootMode: 'killer'});
export function validateSettings(value) {
    if (!value || ![1, 2, 5, 10].includes(value.xpRate) || ![1, 2, 3, 5].includes(value.lootRate) || !['killer', 'shared'].includes(value.lootMode) || Object.keys(value).some(key => !['xpRate', 'lootRate', 'lootMode'].includes(key)))
        throw new Error('Invalid world settings');
    return {xpRate: value.xpRate, lootRate: value.lootRate, lootMode: value.lootMode};
}
export function validateGameMessage(message) {
    if (!message || !['connection', 'data', 'close'].includes(message.type)) throw new Error('Invalid game message');
    if (message.type === 'data') {
        const data = Array.isArray(message.data) ? message.data : Object.values(message.data || {});
        if (data.length < 1 || data.length > 5000 || !data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error('Invalid game packet');
        return {type: 'data', data};
    }
    return {type: message.type};
}
export function isNpcLoot(state) {
    const scripts = [state.script, ...state.frames.slice(0, state.fp).map(frame => frame.script)];
    return scripts.some(script => /^\[?ai_queue3,/.test(script?.info?.scriptName || script?.name || ''));
}
export function lootCount(count, tradeable, npcLoot, settings) {
    return tradeable && npcLoot ? Math.min(0x7fffffff, count * settings.lootRate) : count;
}
