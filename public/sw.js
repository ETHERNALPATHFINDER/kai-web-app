// Caches only the static app shell (HTML/CSS/JS/icons) so the app opens instantly.
// /api/* is always network-only — financial data must never be served from a stale cache.
const CACHE_NAME = "kai-shell-v1";
const SHELL_FILES = [
  "/index.html",
  "/gunluk.html",
  "/style.css",
  "/app.js",
  "/finans.js",
  "/gunluk.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    return; // network-only, never cached
  }
  // Network-first + cache fallback: always prefer the latest deployed file when online
  // (so a new deploy is visible immediately, with no manual cache-clear/incognito step),
  // and fall back to the last-cached copy only if the network request actually fails
  // (e.g. offline). The app has no real offline use case anyway since /api/* is always
  // network-only, so this trades a tiny bit of "instant from cache" speed for never
  // serving a stale shell.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
