/* Travel Expenses — service worker.
   App shell is cached so the app opens with no connection. Navigations are
   network-first (so deploys reach users promptly) with a cache fallback for
   offline; other same-origin assets are served cache-first and refreshed in
   the background. Cross-origin requests (the FX rates API) are not intercepted
   — the app has its own cached-rates fallback in localStorage. */

var VERSION = "v6";
var CACHE = "travel-expenses-" + VERSION;
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* let FX API requests pass through untouched */

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put("./", copy); });
        return res;
      }).catch(function () {
        return caches.match("./").then(function (hit) { return hit || caches.match("./index.html"); });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      var refresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || refresh;
    })
  );
});
