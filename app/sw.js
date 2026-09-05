/**
 * Offline cache.
 *
 * Note: a service worker only registers in a secure context, so this is active
 * over https or on localhost. Reaching the dev server by LAN IP from a phone is
 * plain http, where registration fails harmlessly and the app still runs — it
 * just needs the Mac reachable.
 */

const CACHE = 'tarot-v2';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'corpus.json',
  'manifest.webmanifest',
  'js/app.js',
  'js/art.js',
  'js/deck.js',
  'js/ollama.js',
  'js/reading.js',
  'js/store.js',
  'js/ui.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One bad URL must not fail the whole install.
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));

    // The card scans are listed by the corpus rather than repeated here, so
    // this worker cannot drift out of step with the deck. A scan that fails to
    // cache costs nothing: the drawn face underneath it still renders.
    try {
      const corpus = await (await fetch('corpus.json')).json();
      await Promise.allSettled(
        corpus.cards.map((card) => cache.add(`cards/${card.id}.webp`)));
    } catch { /* offline on first run: images arrive on a later visit */ }

    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Model calls must always go to the network.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      // Refresh in the background so a rebuilt corpus lands on the next launch.
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) (await caches.open(CACHE)).put(request, fresh.clone());
        } catch { /* offline: keep what we have */ }
      })());
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    } catch (err) {
      const fallback = await caches.match('index.html');
      if (fallback) return fallback;
      throw err;
    }
  })());
});
