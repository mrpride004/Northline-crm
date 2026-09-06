// Minimal service worker — exists so Chrome/Android recognizes this as an
// installable app. Intentionally does no caching beyond letting the network
// handle every request, so the CRM always shows live data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // pass-through, required for installability
