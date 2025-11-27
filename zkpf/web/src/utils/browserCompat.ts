/**
 * Browser compatibility utilities for SharedArrayBuffer/WebWallet support
 */

export interface BrowserInfo {
  name: string;
  version: string;
  isSupported: boolean;
  isMobile: boolean;
  supportDetails: {
    hasSharedArrayBuffer: boolean;
    hasCrossOriginIsolation: boolean;
    hasServiceWorker: boolean;
    isSecureContext: boolean;
  };
  recommendation: string | null;
  /** Actions the user can take to fix the issue */
  suggestedActions: SuggestedAction[];
  /** Features that still work without SharedArrayBuffer */
  availableFeatures: string[];
}

export interface SuggestedAction {
  label: string;
  description: string;
  action: 'refresh' | 'clear-cache' | 'use-chrome' | 'use-firefox' | 'use-desktop' | 'check-headers' | 'manual-mode';
}

/**
 * Detect the current browser and its capabilities
 */
export function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent;
  let name = 'Unknown';
  let version = '';
  let isSupported = false;
  let recommendation: string | null = null;
  const suggestedActions: SuggestedAction[] = [];
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Detect browser
  if (ua.includes('Firefox/')) {
    name = 'Firefox';
    version = ua.match(/Firefox\/(\d+)/)?.[1] || '';
    isSupported = parseInt(version) >= 79; // SharedArrayBuffer re-enabled in Firefox 79
  } else if (ua.includes('Edg/')) {
    name = 'Edge';
    version = ua.match(/Edg\/(\d+)/)?.[1] || '';
    isSupported = parseInt(version) >= 88;
  } else if (ua.includes('Chrome/')) {
    name = 'Chrome';
    version = ua.match(/Chrome\/(\d+)/)?.[1] || '';
    isSupported = parseInt(version) >= 92; // SharedArrayBuffer with COEP in Chrome 92+
  } else if (ua.includes('Safari/') && !ua.includes('Chrome') && !ua.includes('Edg')) {
    name = 'Safari';
    // Safari version is in "Version/X.Y" not "Safari/XXX" (which is build number)
    const versionMatch = ua.match(/Version\/(\d+)\.(\d+)/);
    version = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';
    const majorVersion = versionMatch ? parseInt(versionMatch[1]) : 0;
    const minorVersion = versionMatch ? parseInt(versionMatch[2]) : 0;
    
    // Safari 15.2+ supports SharedArrayBuffer with proper headers
    // but iOS Safari has additional restrictions
    // Note: Safari does NOT support service worker header injection - server must send headers
    const hasMinVersion = majorVersion > 15 || (majorVersion === 15 && minorVersion >= 2);
    isSupported = hasMinVersion && !isMobileSafari();
    
    if (isMobileSafari()) {
      recommendation = 'Safari on iOS does not support SharedArrayBuffer. Please use Chrome or Firefox on desktop.';
      suggestedActions.push({
        label: 'Use Desktop',
        description: 'Open this page on a desktop computer with Chrome or Firefox',
        action: 'use-desktop',
      });
    } else if (!hasMinVersion) {
      recommendation = 'Please update Safari to version 15.2 or later, or use Chrome/Firefox.';
      suggestedActions.push({
        label: 'Use Chrome',
        description: 'Chrome has better support for WebAssembly features',
        action: 'use-chrome',
      });
    } else if (isLocalhost) {
      // Safari on localhost - explain the technical limitation
      recommendation = 
        'Safari cannot use the service worker workaround for cross-origin isolation. ' +
        'The Vite dev server sends the correct headers, but Safari may need a cache clear.';
      suggestedActions.push({
        label: 'Clear Cache & Refresh',
        description: 'Press Cmd+Option+E to clear cache, then Cmd+Shift+R to hard refresh',
        action: 'clear-cache',
      });
      suggestedActions.push({
        label: 'Check Headers',
        description: 'Verify the server is sending COOP/COEP headers',
        action: 'check-headers',
      });
      suggestedActions.push({
        label: 'Use Chrome/Firefox',
        description: 'These browsers support the service worker workaround',
        action: 'use-chrome',
      });
    } else {
      // Safari on deployed site - headers should be there
      recommendation = 
        'Safari requires the server to send Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. ' +
        'These should be configured on the deployment, but may need a hard refresh.';
      suggestedActions.push({
        label: 'Hard Refresh',
        description: 'Press Cmd+Shift+R to bypass cache',
        action: 'refresh',
      });
      suggestedActions.push({
        label: 'Check Headers',
        description: 'Verify the server is sending COOP/COEP headers',
        action: 'check-headers',
      });
    }
  }

  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
  
  // Check actual capabilities
  const supportDetails = {
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hasCrossOriginIsolation: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    hasServiceWorker: 'serviceWorker' in navigator,
    isSecureContext: window.isSecureContext,
  };

  // Override isSupported based on actual capabilities
  if (supportDetails.hasSharedArrayBuffer && supportDetails.hasCrossOriginIsolation) {
    isSupported = true;
    recommendation = null;
    suggestedActions.length = 0; // Clear actions if everything works
  } else if (!isSupported && !recommendation) {
    if (!supportDetails.isSecureContext) {
      recommendation = 'This page must be served over HTTPS.';
    } else if (!supportDetails.hasCrossOriginIsolation) {
      recommendation = 'Cross-origin isolation is required for SharedArrayBuffer.';
      if (name !== 'Safari') {
        suggestedActions.push({
          label: 'Hard Refresh',
          description: 'Try Ctrl+Shift+R (Cmd+Shift+R on Mac) to reload with service worker',
          action: 'refresh',
        });
      }
    } else if (!supportDetails.hasSharedArrayBuffer) {
      recommendation = 'Your browser does not support SharedArrayBuffer. Please use Chrome, Firefox, or Edge.';
      suggestedActions.push({
        label: 'Use Chrome',
        description: 'Chrome has full support for all features',
        action: 'use-chrome',
      });
    }
  }

  // Mobile-specific recommendations
  if (isMobile && !isSupported) {
    if (name === 'Safari') {
      recommendation = 'iOS Safari does not support the required features. Please use this app on a desktop browser.';
    } else {
      recommendation = 'Mobile browsers have limited support. For best experience, use a desktop browser.';
    }
    suggestedActions.length = 0;
    suggestedActions.push({
      label: 'Use Desktop Browser',
      description: 'The wallet requires a desktop browser for full functionality',
      action: 'use-desktop',
    });
  }

  // Always add manual mode as a fallback option if not supported
  if (!isSupported) {
    suggestedActions.push({
      label: 'Use Manual Mode',
      description: 'You can still verify proofs and upload pre-built bundles',
      action: 'manual-mode',
    });
  }

  // Features that work without SharedArrayBuffer
  const availableFeatures = isSupported ? [] : [
    'Verify proof bundles',
    'Upload and check attestations',
    'View policy catalog',
    'Download sample bundles',
  ];

  return {
    name,
    version,
    isSupported,
    isMobile,
    supportDetails,
    recommendation,
    suggestedActions,
    availableFeatures,
  };
}

function isMobileSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && ua.includes('Safari') && !ua.includes('Chrome');
}

/**
 * Check if SharedArrayBuffer is actually usable (not just defined)
 */
export function testSharedArrayBuffer(): boolean {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) return false;
    
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.store(view, 0, 42);
    return Atomics.load(view, 0) === 42;
  } catch {
    return false;
  }
}

/**
 * Get browser-specific download links
 */
export function getBrowserDownloadLinks(): Array<{ name: string; url: string; icon: string }> {
  return [
    { name: 'Chrome', url: 'https://www.google.com/chrome/', icon: '🌐' },
    { name: 'Firefox', url: 'https://www.mozilla.org/firefox/', icon: '🦊' },
    { name: 'Edge', url: 'https://www.microsoft.com/edge', icon: '🔷' },
  ];
}

export interface HeaderCheckResult {
  success: boolean;
  headers: {
    coop: string | null;
    coep: string | null;
  };
  crossOriginIsolated: boolean;
  message: string;
}

/**
 * Check if the server is sending the correct COOP/COEP headers.
 * This fetches a fresh copy of the current page and inspects the response headers.
 * Note: This won't work for same-origin requests due to browser security, but the
 * crossOriginIsolated flag tells us if headers are working.
 */
export async function checkCrossOriginHeaders(): Promise<HeaderCheckResult> {
  const crossOriginIsolated = typeof window.crossOriginIsolated !== 'undefined' 
    ? window.crossOriginIsolated 
    : false;

  // We can't directly read response headers from the current page due to security restrictions.
  // However, we can check the crossOriginIsolated flag and provide guidance.
  
  if (crossOriginIsolated) {
    return {
      success: true,
      headers: {
        coop: 'same-origin (inferred)',
        coep: 'credentialless or require-corp (inferred)',
      },
      crossOriginIsolated: true,
      message: 'Cross-origin isolation is active. SharedArrayBuffer should work.',
    };
  }

  // Try to fetch a resource and check for CORS headers as a proxy
  try {
    const response = await fetch(window.location.href, {
      method: 'HEAD',
      cache: 'no-store',
    });
    
    // Note: Due to CORS, we often can't read these headers, but try anyway
    const coop = response.headers.get('cross-origin-opener-policy');
    const coep = response.headers.get('cross-origin-embedder-policy');

    if (coop && coep) {
      return {
        success: false, // Still not isolated despite headers
        headers: { coop, coep },
        crossOriginIsolated: false,
        message: `Headers present (COOP: ${coop}, COEP: ${coep}) but page is not cross-origin isolated. Try a hard refresh.`,
      };
    }

    return {
      success: false,
      headers: { coop: null, coep: null },
      crossOriginIsolated: false,
      message: 
        'Could not read COOP/COEP headers (this is normal due to browser security). ' +
        'The crossOriginIsolated flag is false, meaning headers may not be configured correctly on the server.',
    };
  } catch (error) {
    return {
      success: false,
      headers: { coop: null, coep: null },
      crossOriginIsolated: false,
      message: `Error checking headers: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get Safari-specific troubleshooting steps
 */
export function getSafariTroubleshootingSteps(): string[] {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  if (isLocalhost) {
    return [
      '1. Safari does NOT support the service worker header injection workaround.',
      '2. For local development, please use Chrome or Firefox instead.',
      '3. Alternatively, run `npm run build && npm run preview` which serves with proper headers.',
      '4. If you must use Safari locally, ensure your dev server sends:',
      '   • Cross-Origin-Opener-Policy: same-origin',
      '   • Cross-Origin-Embedder-Policy: credentialless',
    ];
  }

  return [
    '1. Clear Safari cache: Develop menu → Empty Caches (or Cmd+Option+E)',
    '2. Hard refresh: Cmd+Shift+R',
    '3. Check if the site sends COOP/COEP headers (use Safari Web Inspector → Network tab)',
    '4. If headers are missing, this is a server configuration issue.',
    '5. As a workaround, use Chrome or Firefox which support the service worker fallback.',
  ];
}

