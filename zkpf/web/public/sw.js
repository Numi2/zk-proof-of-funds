/**
 * Service Worker for Zcash Shielded Wallet PWA
 * 
 * Provides offline caching for static assets.
 * Note: WASM wallet functionality requires network for blockchain sync.
 */

const CACHE_NAME = 'zkpf-wallet-v1';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/wallet',
  '/p2p',
  '/manifest.json',
  '/image.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip cross-origin requests (like lightwalletd gRPC)
  if (!request.url.startsWith(self.location.origin)) return;
  
  // Skip WASM files (too large to cache reliably)
  if (request.url.includes('.wasm')) return;
  
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone response for caching
        const responseClone = response.clone();
        
        // Cache successful responses
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // For navigation requests, return cached index
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          
          // Return offline fallback for other requests
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        });
      })
  );
});

