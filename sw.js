const CACHE_NAME = "khaikhong-v2-3-12";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icons/icon-192.svg", "./icons/icon-512.svg", "./reset-pin.html", "./clear-cache.html"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === "navigate";
  const isCore = /\/(index\.html|app\.js|styles\.css|manifest\.json|reset-pin\.html|clear-cache\.html)$/.test(url.pathname);

  if (isNavigation || isCore || url.searchParams.has("pinOff") || url.searchParams.has("resetPin")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html"))));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
