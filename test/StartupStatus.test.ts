/** @jest-environment jsdom */
import {setPageStatus, showStartupError, startClient} from '../src/js/page-shell';
jest.mock('../src/style/page-shell.scss', (): object => ({}));

test('startup preserves the original failure and renders it as text', async (): Promise<void> => {
    jest.spyOn(console, 'error').mockImplementation((): void => {});
    await startClient(async (): Promise<void> => { throw new Error('HTTP 503: https://world.example/crc <script>unsafe</script>'); });
    expect(document.getElementById('lore-status-message')!.textContent).toContain('HTTP 503: https://world.example/crc <script>unsafe</script>');
    expect(document.querySelector('.lore-status script')).toBeNull();
    expect(document.getElementById('lore-retry')!.hidden).toBe(false);
    jest.restoreAllMocks();
});

test('browser error events preserve useful diagnostics', (): void => {
    showStartupError(new ErrorEvent('error', {error: new Error('Missing local worker bundle.')}));
    expect(document.getElementById('lore-status-message')!.textContent).toContain('Missing local worker bundle.');
});

test('a recoverable error can retry without reloading and resets the action after recovery', (): void => {
    const choose: jest.Mock = jest.fn();
    setPageStatus('That file is not a cache.', true, {label: 'Choose another cache', action: choose});
    const retry: HTMLButtonElement = document.getElementById('lore-retry') as HTMLButtonElement;
    expect(retry.textContent).toBe('Choose another cache');
    retry.click();
    expect(choose).toHaveBeenCalledTimes(1);
    setPageStatus('Imported 6 cache files.');
    expect(retry.hidden).toBe(true);
    setPageStatus('Server offline.', true);
    expect(retry.textContent).toBe('Reload and retry');
});
