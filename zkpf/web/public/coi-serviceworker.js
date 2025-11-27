/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
/*
 * Cross-Origin Isolation Service Worker
 * 
 * This service worker enables SharedArrayBuffer support by injecting 
 * Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.
 * 
 * SharedArrayBuffer is required for multi-threaded WASM execution (wasm-bindgen-rayon)
 * which significantly speeds up ZK proof generation and wallet sync operations.
 * 
 * Based on: https://github.com/nicferrier/coi-serviceworker
 */

// Default to credentialless mode - this is more permissive and allows external resources
// without CORP headers (like fonts, images from CDNs, API calls)
let coepCredentialless = true;

if (typeof window === 'undefined') {
  // =====================
  // Service Worker Context
  // =====================
  
  self.addEventListener('install', () => {
    console.log('🔧 COI-SW: Installing...');
    self.skipWaiting();
  });
  
  self.addEventListener('activate', (event) => {
    console.log('🔧 COI-SW: Activating...');
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    
    if (ev.data.type === 'deregister') {
      self.registration.unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
    }
    
    if (ev.data.type === 'coepCredentialless') {
      coepCredentialless = ev.data.value;
    }
  });

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    
    // Skip requests that can't be intercepted
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return;
    }

    // Handle navigation requests (HTML pages) - inject COOP/COEP headers
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((response) => {
            // Can't modify opaque responses
            if (response.status === 0) {
              return response;
            }

            const coepValue = coepCredentialless ? 'credentialless' : 'require-corp';
            const headers = new Headers(response.headers);
            headers.set('Cross-Origin-Embedder-Policy', coepValue);
            headers.set('Cross-Origin-Opener-Policy', 'same-origin');

            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          })
          .catch((e) => {
            // IMPORTANT: Don't block navigation on errors - let the browser handle it
            // This prevents the "UI disappearing" issue
            console.warn('COI-SW: fetch error, falling back to network:', e);
            // Return undefined to let the browser handle the request normally
            return fetch(request);
          })
      );
      return;
    }

    // For all other requests, don't intercept - let them pass through normally
    // This is more reliable and prevents the service worker from breaking things
  });
  
} else {
  // =====================
  // Window Context (Registration)
  // =====================
  
  (() => {
    const log = (msg) => console.info(`🔧 COI-SW: ${msg}`);
    const warn = (msg) => console.warn(`⚠️ COI-SW: ${msg}`);
    const error = (msg, e) => console.error(`❌ COI-SW: ${msg}`, e || '');

    // Detect Safari (Safari doesn't support service worker header injection)
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // Only log diagnostic info in development
    if (isLocalhost) {
      log(`Browser: ${isSafari ? 'Safari' : 'Other'}`);
      log(`crossOriginIsolated: ${window.crossOriginIsolated}`);
      log(`SharedArrayBuffer available: ${typeof SharedArrayBuffer !== 'undefined'}`);
    }

    // Check if already cross-origin isolated
    if (window.crossOriginIsolated) {
      if (isLocalhost) log('Already cross-origin isolated ✅');
      return;
    }

    // Safari-specific handling - don't register, just warn once
    if (isSafari) {
      warn('Safari: Service worker header injection not supported. Some wallet features may be limited.');
      return;
    }

    // Must be served over HTTPS (or localhost)
    if (!window.isSecureContext) {
      return;
    }

    // Check if service workers are supported
    if (!navigator.serviceWorker) {
      return;
    }

    // Track if we've already reloaded to prevent reload loops
    const reloadKey = 'coi-sw-reload-' + window.location.pathname;
    const hasReloaded = sessionStorage.getItem(reloadKey);
    
    // Get the service worker URL
    const currentScript = document.currentScript;
    let serviceWorkerUrl = '/coi-serviceworker.js';
    
    if (currentScript && currentScript.src) {
      const scriptUrl = new URL(currentScript.src);
      serviceWorkerUrl = scriptUrl.pathname;
    }

    // Register the service worker
    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .then((registration) => {
        // If already controlling and isolated, we're done
        if (registration.active && navigator.serviceWorker.controller) {
          if (window.crossOriginIsolated) {
            if (isLocalhost) log('Cross-origin isolation active ✅');
          }
          return;
        }

        // If active but not controlling, reload ONCE to enable
        if (registration.active && !navigator.serviceWorker.controller && !hasReloaded) {
          sessionStorage.setItem(reloadKey, 'true');
          window.location.reload();
          return;
        }

        // Wait for the service worker to become active, then reload ONCE
        const worker = registration.installing || registration.waiting;
        if (worker && !hasReloaded) {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
              sessionStorage.setItem(reloadKey, 'true');
              window.location.reload();
            }
          });
        }
      })
      .catch((err) => {
        // Silent fail - don't break the app if service worker fails
        if (isLocalhost) error('Service worker registration failed:', err);
      });
  })();
}

