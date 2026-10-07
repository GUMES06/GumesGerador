'use strict';

const CACHE = 'card-test-lab-v7';

const ASSETS = [
  './',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './gumes-profile.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(
              k =>
                k.startsWith('card-test-lab-') &&
                k !== CACHE
            )
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Cache only this app's public shell,
  // never login pages or redirects.
  const path = url.pathname.slice(
    new URL(self.registration.scope).pathname.length
  );

  if (
    ![
      '',
      'index.html',
      'style.css',
      'app.js',
      'manifest.webmanifest',
      'icon-192.png',
      'icon-512.png',
      'gumes-profile.png'
    ].includes(path)
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && !response.redirected) {
          const copy = response.clone();

          caches
            .open(CACHE)
            .then(cache => cache.put(event.request, copy));
        }

        return response;
      })
      .catch(() =>
        caches.match(event.request).then(
          cached =>
            cached ||
            (event.request.mode === 'navigate'
              ? caches.match('./')
              : Response.error())
        )
      )
  );
});