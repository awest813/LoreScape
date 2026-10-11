export function setupManifest(): void {
    const manifest: HTMLLinkElement = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = new URL('manifest.json', window.location.href).href;
    document.head.appendChild(manifest);
}
