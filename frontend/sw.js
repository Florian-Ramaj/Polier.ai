// Cache-Name
// - bei Änderungen Version hochzählen
const CACHE_NAME = "polier-v54";
const DATEIEN = [
  "./",
  "style.css",
  "app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

// Installieren: Dateien einmal speichern
// - skipWaiting: neue Version sofort aktiv
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(DATEIEN))
  );
});

// Aufräumen: alte Caches löschen
// - clients.claim: offene Seiten sofort übernehmen
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(
        namen.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// Abrufen
// - nur eigene GET-Dateien (App-Huelle) laufen über den Cache
// - Backend-Antworten NIE cachen: sonst sieht ein totes Backend
//   lebendig aus, weil der Cache alte Antworten liefert
// - nur erfolgreiche Antworten cachen, sonst landet eine 502-Seite
//   als App-Huelle im Cache
const STATISCHE_DATEI = /\.(?:css|js|json|png|jpg|jpeg|svg|webmanifest)$/;

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  // sw.js nie cachen, sonst haengt eine alte Version fest
  if (url.pathname.endsWith("/sw.js")) {
    return;
  }
  const istSeite = event.request.mode === "navigate" || url.pathname === "/";
  const istDatei = STATISCHE_DATEI.test(url.pathname);
  if (!istSeite && !istDatei) {
    return;  // alles andere ist Backend: direkt durchlassen
  }
  event.respondWith(
    fetch(event.request)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(event.request))
  );
});
