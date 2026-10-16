export function setupManifest(): void {
    if (document.querySelector('link[rel="manifest"]')) return;
    const manifest: HTMLLinkElement = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = new URL('manifest.json', window.location.href).href;
    document.head.appendChild(manifest);
}
