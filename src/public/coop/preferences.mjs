export const DEFAULT_PREFERENCES = Object.freeze({detail: 'low', fps: 30, scale: 'fit', mute: true});
export function validatePreferences(value) {
    if (!value || !['low', 'high'].includes(value.detail) || ![15, 30, 50].includes(value.fps) || !['fit', 'native', 'large'].includes(value.scale) || typeof value.mute !== 'boolean') throw new Error('Invalid device preferences');
    return {detail: value.detail, fps: value.fps, scale: value.scale, mute: value.mute};
}
export function loadPreferences() {
    try {
        return validatePreferences(JSON.parse(localStorage.getItem('lorescape-device-v1')));
    } catch {
        return {...DEFAULT_PREFERENCES};
    }
}
export function savePreferences(value) {
    const preferences = validatePreferences(value);
    localStorage.setItem('lorescape-device-v1', JSON.stringify(preferences));
    return preferences;
}
