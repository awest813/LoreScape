/** @jest-environment jsdom */
import {showStartupError, startClient} from '../src/js/page-shell';
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
