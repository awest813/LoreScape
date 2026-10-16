export const sleep = async (ms: number): Promise<void> => new Promise((resolve): NodeJS.Timeout => setTimeout(resolve, ms));
// Keep the timeout active until the response body has been consumed.
async function download(url: string, binary: boolean, timeoutMs: number): Promise<ArrayBuffer | string> {
    const controller: AbortController = new AbortController();
    const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => controller.abort(), timeoutMs);
    try {
        const response: Response = await fetch(url, {signal: controller.signal});
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
        return binary ? await response.arrayBuffer() : await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

export async function downloadUrl(url: string, timeoutMs: number = 30000): Promise<Int8Array> {
    return new Int8Array((await download(url, true, timeoutMs)) as ArrayBuffer);
}

export async function downloadText(url: string, timeoutMs: number = 30000): Promise<string> {
    return (await download(url, false, timeoutMs)) as string;
}

export function arraycopy(src: Int32Array | Uint8Array, srcPos: number, dst: Int32Array | Uint8Array, dstPos: number, length: number): void {
    while (length--) dst[dstPos++] = src[srcPos++];
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
    let result: bigint = 0n;
    for (let index: number = 0; index < bytes.length; index++) {
        result = (result << 8n) | BigInt(bytes[index]);
    }
    return result;
}

export function bigIntToBytes(bigInt: bigint): Uint8Array {
    const bytes: number[] = [];
    while (bigInt > 0n) {
        bytes.unshift(Number(bigInt & 0xffn));
        bigInt >>= 8n;
    }

    if (bytes[0] & 0x80) {
        bytes.unshift(0);
    }

    return new Uint8Array(bytes);
}

export function bigIntModPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result: bigint = 1n;
    while (exponent > 0n) {
        if (exponent % 2n === 1n) {
            result = (result * base) % modulus;
        }
        base = (base * base) % modulus;
        exponent >>= 1n;
    }
    return result;
}
