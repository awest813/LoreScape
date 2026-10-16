/** @jest-environment jsdom */
import {setupManifest} from '../src/js/manifest';

const originalURL: string = window.location.href;
afterEach((): void => {
    document.head.innerHTML = '';
    window.history.replaceState(null, '', originalURL);
});

test.each(['/LoreScape/', '/LoreScape/?world=1', '/LoreScape/index.html?world=2#canvas', '/LoreScape/items.html'])('manifest resolves beside the page at %s', (path: string): void => {
    window.history.replaceState(null, '', path);
    setupManifest();
    setupManifest();
    const links: NodeListOf<HTMLLinkElement> = document.querySelectorAll('link[rel="manifest"]');
    expect(links).toHaveLength(1);
    expect(new URL(links[0].href).pathname).toBe('/LoreScape/manifest.json');
});

test('manifest also works on a root domain', (): void => {
    window.history.replaceState(null, '', '/');
    setupManifest();
    expect(new URL(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href).pathname).toBe('/manifest.json');
});
