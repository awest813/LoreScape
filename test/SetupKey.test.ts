import {generateKeyPairSync, JsonWebKey} from 'node:crypto';
import {parseSetupKey} from '../src/js/setup-key';

test('accepts a normal installation RSA public key for revision 225', (): void => {
    const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 1024});
    const key: JsonWebKey = publicKey.export({format: 'jwk'});
    const modulus: bigint = BigInt('0x' + Buffer.from(key.n!, 'base64url').toString('hex'));
    expect(parseSetupKey({version: 1, revision: 225, modulus: modulus.toString(), exponent: '65537'})).toBe(modulus);
});

test.each([
    null,
    {version: 1, revision: 317, exponent: '65537', modulus: '9'.repeat(154)},
    {version: 1, revision: 225, exponent: '3', modulus: '9'.repeat(154)},
    {version: 1, revision: 225, exponent: '65537', modulus: '1'.repeat(153)},
    {version: 1, revision: 225, exponent: '65537', modulus: '9'.repeat(309)},
    {version: 1, revision: 225, exponent: '65537', modulus: '8'.repeat(154)},
    {version: 1, revision: 225, exponent: '65537', modulus: '<script>'}
])('rejects incompatible or malformed installation keys', (value: unknown): void => {
    expect((): bigint => parseSetupKey(value)).toThrow();
});
