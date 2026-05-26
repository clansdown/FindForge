const CACHE_NAME = 'findforge-research-v1';

function networkFirst(request, cacheName, fetchEvent) {
    const fetchOptions = { cache: 'no-cache' };
    return fetch(request, fetchOptions).then(function(response) {
        if (response.ok) {
            const responseClone = response.clone();
            caches.open(cacheName).then(function(cache) {
                cache.put(request, responseClone);
            });
        }
        return response;
    }).catch(function() {
        return caches.match(request).then(function(cached) {
            if (cached) return cached;
            if (fetchEvent.request.mode === 'navigate') {
                return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
        });
    });
}

self.addEventListener('install', function(event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(key) { return key !== CACHE_NAME; })
                    .map(function(key) { return caches.delete(key); })
            );
        })
    );
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
    event.respondWith(networkFirst(event.request, CACHE_NAME, event));
});
