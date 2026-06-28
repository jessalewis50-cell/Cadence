// Minimal service worker — registers to satisfy PWA installability on iOS.
// No caching: all requests go to network. This prevents stale-cache issues
// after deployments while still enabling "Add to Home Screen" on Safari.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
