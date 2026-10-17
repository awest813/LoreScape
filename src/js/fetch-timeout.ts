// AbortSignal.timeout is absent in some otherwise supported Safari/Chrome versions.
// Keep the timeout active while the response body is read, and release it on failure.
export async function fetchJsonWithTimeout(url: string, timeout: number): Promise<unknown> {
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => controller.abort(), timeout);
    try {
        const response: Response = await fetch(url, {signal: controller.signal, cache: 'no-store'});
        if (!response.ok) throw new Error('Setup kit login configuration is unavailable. Restart node start.cjs and open its launcher link.');
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}
