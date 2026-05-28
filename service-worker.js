const CACHE_NAME = '9mm-v2.3.4';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './engine.js',
    './evaluator.js',
    './searcher.js',
    './searcher.worker.js',
    './ai.js',
    './taunt.js',
    './game.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    const isLocal = ['localhost', '127.0.0.1'].includes(self.location.hostname);
    if (isLocal) {
        e.respondWith(fetch(e.request));
    } else {
        e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
    }
});
