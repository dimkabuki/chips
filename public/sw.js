const CACHE_NAME = "chips-static-v3";
const scopeUrl = new URL(self.registration.scope);
const scoped = (path) => new URL(path, scopeUrl).toString();
const STATIC_ASSETS = [scoped("./index.html"), scoped("./manifest.webmanifest"), scoped("./icon.svg")];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

const cacheFirst = (request) => caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => { void cache.put(request, copy); });
  }
  return response;
}));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(scoped("./index.html"))));
    return;
  }
  event.respondWith(cacheFirst(event.request).catch(() => caches.match(event.request)));
});
