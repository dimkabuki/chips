const CACHE_NAME = "chips-static-v2";
const scopeUrl = new URL(self.registration.scope);
const scoped = (path) => new URL(path, scopeUrl).toString();
const STATIC_ASSETS = [scoped("./"), scoped("./index.html"), scoped("./manifest.webmanifest")];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => { void cache.put(event.request, copy); });
    return response;
  }).catch(() => caches.match(scoped("./index.html")))));
});
