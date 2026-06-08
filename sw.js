/* Service worker для офлайн-режима PWA.
   Стратегия: network-first (онлайн — всегда свежий код, важно для dev-режима
   с ?t=Date.now()), с откатом на кэш, когда сети нет (iPad офлайн). */
"use strict";
const CACHE = "mars-survival-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/engine.js",
  "./js/scenes.js",
  "./js/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    fetch(req)
      .then((resp) => {
        // обновляем кэш свежей копией (для следующего офлайн-запуска)
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy).catch(() => {}));
        return resp;
      })
      .catch(() =>
        // офлайн — отдаём из кэша; ignoreSearch, т.к. js грузятся с ?t=...
        caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
