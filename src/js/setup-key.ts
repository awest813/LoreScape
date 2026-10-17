/** Only used by an explicitly selected, same-origin local setup kit. */
export function parseSetupKey(value: unknown): bigint {
    if (!value || typeof value !== 'object') throw new Error('Invalid setup kit login configuration.');
    const key: Record<string, unknown> = value as Record<string, unknown>;
    if (key.version !== 1 || key.revision !== 225 || key.exponent !== '65537' || typeof key.modulus !== 'string' || !/^[1-9]\d{153,308}$/.test(key.modulus)) {
        throw new Error('Incompatible setup kit login configuration.');
    }
    const modulus: bigint = BigInt(key.modulus);
    if (modulus < 2n ** 511n || modulus >= 2n ** 1024n || modulus % 2n === 0n) throw new Error('Invalid setup kit login key size.');
    return modulus;
}
