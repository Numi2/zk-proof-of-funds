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

            console.log(`🔧 COI-SW: Injecting headers (COEP: ${coepValue}) for ${request.url}`);

            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          })
          .catch((e) => {
            console.error('COI-SW fetch error:', e);
            return new Response('Network error', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' },
            });
          })
      );
      return;
    }

    // For non-navigation requests in credentialless mode, strip credentials
    // This helps avoid CORS issues with external resources
    if (coepCredentialless && request.mode === 'no-cors') {
      event.respondWith(
        fetch(request, { credentials: 'omit' })
          .catch((e) => {
            console.error('COI-SW no-cors fetch error:', e);
            return new Response(null, { status: 0, statusText: '' });
          })
      );
      return;
    }
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
    
    // Diagnostic info
    log(`Browser: ${isSafari ? 'Safari' : 'Other'}`);
    log(`crossOriginIsolated: ${window.crossOriginIsolated}`);
    log(`isSecureContext: ${window.isSecureContext}`);
    log(`SharedArrayBuffer available: ${typeof SharedArrayBuffer !== 'undefined'}`);
    log(`Host: ${window.location.hostname}`);

    // Check if already cross-origin isolated
    if (window.crossOriginIsolated) {
      log('Already cross-origin isolated (SharedArrayBuffer enabled) ✅');
      return;
    }

    // Safari-specific handling
    if (isSafari) {
      warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      warn('Safari detected. Service worker header injection is NOT supported.');
      warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      if (isLocalhost) {
        warn('');
        warn('📍 LOCAL DEVELOPMENT:');
        warn('   Safari requires actual server headers for cross-origin isolation.');
        warn('   The Vite dev server sends these headers, but Safari may be caching.');
        warn('');
        warn('   Try these steps:');
        warn('   1. Clear Safari cache: Develop → Empty Caches (Cmd+Option+E)');
        warn('   2. Hard refresh: Cmd+Shift+R');
        warn('   3. If still not working, use Chrome or Firefox for local development');
        warn('');
        warn('   Alternative: Run "npm run build && npm run preview" for a production-like build');
      } else {
        warn('');
        warn('📍 DEPLOYED SITE:');
        warn('   Server should be sending COOP/COEP headers.');
        warn('   If SharedArrayBuffer is still not available:');
        warn('   1. Clear Safari cache: Develop → Empty Caches (Cmd+Option+E)');
        warn('   2. Hard refresh: Cmd+Shift+R');
        warn('   3. Check server headers in Safari Web Inspector → Network tab');
        warn('');
        warn('   Expected headers:');
        warn('     Cross-Origin-Opener-Policy: same-origin');
        warn('     Cross-Origin-Embedder-Policy: credentialless');
      }
      warn('');
      warn('ℹ️  Wallet features are unavailable, but proof verification still works.');
      warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      // Don't register the service worker on Safari - it won't help
      return;
    }

    // Must be served over HTTPS (or localhost)
    if (!window.isSecureContext) {
      warn('Not a secure context (needs HTTPS or localhost). SharedArrayBuffer unavailable.');
      return;
    }

    // Check if service workers are supported
    if (!navigator.serviceWorker) {
      warn('Service workers not supported in this browser. SharedArrayBuffer unavailable.');
      return;
    }

    // Get the service worker URL - prefer same path as the script
    const currentScript = document.currentScript;
    let serviceWorkerUrl = '/coi-serviceworker.js';
    
    if (currentScript && currentScript.src) {
      // Use the same URL as the script tag
      const scriptUrl = new URL(currentScript.src);
      serviceWorkerUrl = scriptUrl.pathname;
    }

    log(`Registering service worker from: ${serviceWorkerUrl}`);

    // Register the service worker
    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .then((registration) => {
        log('Service worker registered successfully');
        
        // Handle updates
        registration.addEventListener('updatefound', () => {
          log('Update found, installing new version...');
        });

        // If already controlling, we should be isolated - if not, something's wrong
        if (registration.active && navigator.serviceWorker.controller) {
          if (!window.crossOriginIsolated) {
            warn('Service worker is controlling but not isolated. Try a hard refresh (Ctrl+Shift+R).');
          } else {
            log('Already controlling and isolated ✅');
          }
          return;
        }

        // If active but not controlling, reload to enable
        if (registration.active && !navigator.serviceWorker.controller) {
          log('Active but not controlling - reloading to enable isolation...');
          window.location.reload();
          return;
        }

        // Wait for the service worker to become active
        const worker = registration.installing || registration.waiting;
        if (worker) {
          log(`Waiting for service worker to activate (current state: ${worker.state})...`);
          
          worker.addEventListener('statechange', () => {
            log(`Service worker state changed to: ${worker.state}`);
            if (worker.state === 'activated') {
              log('Activated! Reloading to enable cross-origin isolation...');
              window.location.reload();
            }
          });
        }
      })
      .catch((err) => {
        error('Failed to register service worker:', err);
      });
  })();
}

