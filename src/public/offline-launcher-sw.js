// The full game has its own narrower service-worker scope under offline/.
// Register this navigation fallback only after a verified installation succeeds.
const BASE = new URL(self.registration.scope);
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== BASE.origin || ![BASE.pathname, new URL('index.html', BASE).pathname].includes(url.pathname)) return;
    event.respondWith(fetch(event.request).catch(() => Response.redirect(new URL('offline/coop.html', BASE))));
});
