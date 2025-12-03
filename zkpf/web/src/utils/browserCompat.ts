/**
 * Browser compatibility utilities for SharedArrayBuffer/WebWallet support
 * 
 * The Zcash WASM wallet requires SharedArrayBuffer for multi-threaded operations.
 * This file provides detection and fallback guidance for different browser environments:
 * 
 * - Full support: Desktop Chrome/Firefox/Edge with cross-origin isolation
 * - Limited support: Safari (requires proper server headers, no SW workaround)
 * - No support: iOS Safari, older browsers (use "lite mode" features)
 */

export type WalletMode = 'full' | 'lite' | 'unknown';

export interface BrowserInfo {
  name: string;
  version: string;
  isSupported: boolean;
  isMobile: boolean;
  /** The recommended wallet mode based on browser capabilities */
  walletMode: WalletMode;
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
  /** Why the browser can't use full mode (detailed technical reason) */
  technicalReason: string | null;
}

export interface SuggestedAction {
  label: string;
  description: string;
  action: 'refresh' | 'clear-cache' | 'use-chrome' | 'use-firefox' | 'use-desktop' | 'check-headers' | 'manual-mode' | 'lite-mode';
}

/**
 * Features available in "lite mode" (no SharedArrayBuffer required)
 */
export const LITE_MODE_FEATURES = [
  'P2P Marketplace - post and respond to offers',
  'Verify proof bundles from others',
  'View and manage attestations',
  'Browse policy catalog',
  'Share offers via links',
  'Encrypted chat (if WASM loads)',
] as const;

/**
 * Features that require full wallet mode (SharedArrayBuffer)
 */
export const FULL_MODE_FEATURES = [
  'Zcash wallet sync with blockchain',
  'Generate ZK proofs locally',
  'Create shielded transactions',
  'View shielded balance',
] as const;

/**
 * Detect the current browser and its capabilities
 */
export function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent;
  let name = 'Unknown';
  let version = '';
  let isSupported = false;
  let recommendation: string | null = null;
  let technicalReason: string | null = null;
  const suggestedActions: SuggestedAction[] = [];
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isProduction = !isLocalhost && window.location.protocol === 'https:';

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
      const iosVersion = getIOSVersion();
      const iosHasSAB = iosSupportsSharedArrayBuffer();
      // Check cross-origin isolation directly (supportDetails isn't declared yet)
      const hasCOI = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
      
      if (iosHasSAB) {
        // iOS 15.2+ supports SAB with cross-origin isolation
        isSupported = true;
        if (!hasCOI) {
          technicalReason = `iOS ${iosVersion?.major}.${iosVersion?.minor} supports SharedArrayBuffer, but page is not cross-origin isolated.`;
          recommendation = 'Cross-origin isolation headers may be missing. Try refreshing or contact support.';
          isSupported = false;
        }
      } else {
        technicalReason = `iOS ${iosVersion?.major || '?'}.${iosVersion?.minor || '?'} is below 15.2 - SharedArrayBuffer requires iOS 15.2+.`;
        recommendation = 'Please update iOS to 15.2 or later, or use a desktop browser for full wallet features.';
        suggestedActions.push({
          label: 'Continue in Lite Mode',
          description: 'P2P trading, verification, and more work on any device',
          action: 'lite-mode',
        });
        suggestedActions.push({
          label: 'Open on Desktop',
          description: 'For full wallet sync, use Chrome or Firefox on a computer',
          action: 'use-desktop',
        });
      }
    } else if (!hasMinVersion) {
      technicalReason = `Safari ${version || 'version'} is too old. SharedArrayBuffer requires Safari 15.2+.`;
      recommendation = 'Please update Safari to version 15.2 or later, or use Chrome/Firefox.';
      suggestedActions.push({
        label: 'Use Chrome',
        description: 'Chrome has full support for all features',
        action: 'use-chrome',
      });
    } else if (isLocalhost) {
      // Safari on localhost - explain the technical limitation clearly
      technicalReason = 
        'Safari cannot use the service worker workaround for cross-origin isolation. ' +
        'Unlike Chrome/Firefox, Safari requires the actual HTTP server to send COOP/COEP headers.';
      recommendation = 
        'For local development with Safari, use "npm run build && npm run preview" which serves with proper headers. ' +
        'Or use Chrome/Firefox for development.';
      suggestedActions.push({
        label: 'Use Chrome/Firefox',
        description: 'These browsers support the service worker workaround for local dev',
        action: 'use-chrome',
      });
      suggestedActions.push({
        label: 'Run Preview Build',
        description: 'Run "npm run build && npm run preview" for proper headers',
        action: 'check-headers',
      });
      suggestedActions.push({
        label: 'Continue in Lite Mode',
        description: 'Use P2P marketplace and verification without full wallet',
        action: 'lite-mode',
      });
    } else if (isProduction) {
      // Safari on deployed site - headers should be there, might need cache clear
      recommendation = 
        'Safari should work on this site. If you see this message, try clearing your cache.';
      suggestedActions.push({
        label: 'Clear Cache & Refresh',
        description: 'Press Cmd+Option+E, then Cmd+Shift+R',
        action: 'clear-cache',
      });
      suggestedActions.push({
        label: 'Check Headers',
        description: 'Verify COOP/COEP headers in Network tab',
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
    technicalReason = null;
    suggestedActions.length = 0; // Clear actions if everything works
  } else if (!isSupported && !recommendation) {
    if (!supportDetails.isSecureContext) {
      technicalReason = 'SharedArrayBuffer requires a secure context (HTTPS or localhost).';
      recommendation = 'This page must be served over HTTPS.';
    } else if (!supportDetails.hasCrossOriginIsolation) {
      technicalReason = 'The page is not cross-origin isolated. COOP/COEP headers are missing or incorrect.';
      recommendation = 'Cross-origin isolation is required for SharedArrayBuffer.';
      if (name !== 'Safari') {
        suggestedActions.push({
          label: 'Hard Refresh',
          description: 'Try Ctrl+Shift+R (Cmd+Shift+R on Mac) to reload with service worker',
          action: 'refresh',
        });
      }
    } else if (!supportDetails.hasSharedArrayBuffer) {
      technicalReason = 'Your browser does not expose the SharedArrayBuffer API.';
      recommendation = 'Please use Chrome, Firefox, or Edge for full wallet support.';
      suggestedActions.push({
        label: 'Use Chrome',
        description: 'Chrome has full support for all features',
        action: 'use-chrome',
      });
    }
  }

  // Mobile-specific handling
  // Note: Modern mobile browsers (iOS 15.2+, Android Chrome 92+) DO support SAB with cross-origin isolation
  if (isMobile && !isSupported) {
    // Only show mobile-specific messaging if we're actually blocked
    if (supportDetails.hasCrossOriginIsolation && !supportDetails.hasSharedArrayBuffer) {
      // Cross-origin isolation works but SAB is unavailable - likely old browser
      if (name === 'Safari') {
        technicalReason = 'iOS version too old for SharedArrayBuffer. Requires iOS 15.2+.';
        recommendation = 'Update iOS to 15.2+ for full wallet support, or use Lite Mode.';
      } else {
        technicalReason = 'Browser version does not support SharedArrayBuffer.';
        recommendation = 'Update your browser for full wallet support, or use Lite Mode.';
      }
    } else if (!supportDetails.hasCrossOriginIsolation) {
      // Cross-origin isolation is the issue
      technicalReason = 'Page is not cross-origin isolated (COOP/COEP headers may be missing).';
      recommendation = 'This may be a server configuration issue. Try refreshing.';
    }
    
    if (!suggestedActions.some(a => a.action === 'lite-mode')) {
      suggestedActions.push({
        label: 'Use Lite Mode',
        description: 'P2P trading, verification, and more - works on all devices',
        action: 'lite-mode',
      });
    }
    if (!suggestedActions.some(a => a.action === 'use-desktop')) {
      suggestedActions.push({
        label: 'Open on Desktop',
        description: 'For full wallet sync and proof generation',
        action: 'use-desktop',
      });
    }
  }

  // Always add lite mode as a fallback option if not supported
  if (!isSupported && !suggestedActions.some(a => a.action === 'lite-mode')) {
    suggestedActions.push({
      label: 'Use Lite Mode',
      description: 'P2P marketplace, proof verification, and more - works everywhere',
      action: 'lite-mode',
    });
  }

  // Determine wallet mode
  const walletMode: WalletMode = isSupported ? 'full' : 'lite';

  // Features that work without SharedArrayBuffer
  const availableFeatures = isSupported ? [] : [...LITE_MODE_FEATURES];

  return {
    name,
    version,
    isSupported,
    isMobile,
    walletMode,
    supportDetails,
    recommendation,
    suggestedActions,
    availableFeatures,
    technicalReason,
  };
}

function isMobileSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && ua.includes('Safari') && !ua.includes('Chrome');
}

/**
 * Get iOS version if on iOS, otherwise null
 */
function getIOSVersion(): { major: number; minor: number } | null {
  const ua = navigator.userAgent;
  const match = ua.match(/OS (\d+)_(\d+)/);
  if (match && /iPhone|iPad|iPod/.test(ua)) {
    return { major: parseInt(match[1]), minor: parseInt(match[2]) };
  }
  return null;
}

/**
 * Check if iOS version supports SharedArrayBuffer (15.2+)
 */
function iosSupportsSharedArrayBuffer(): boolean {
  const version = getIOSVersion();
  if (!version) return false;
  return version.major > 15 || (version.major === 15 && version.minor >= 2);
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
    { name: 'Chrome', url: 'https://www.google.com/chrome/', icon: 'Chrome' },
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
      '2. For local development with full wallet, use Chrome or Firefox instead.',
      '3. Or run `npm run build && npm run preview` which serves with proper headers.',
      '4. Lite Mode (P2P, verification) works in Safari without special headers.',
    ];
  }

  return [
    '1. Clear Safari cache: Develop menu → Empty Caches (or Cmd+Option+E)',
    '2. Hard refresh: Cmd+Shift+R',
    '3. Check COOP/COEP headers in Safari Web Inspector → Network tab',
    '4. If headers are correct but still failing, try a private window',
    '5. Lite Mode is always available as a fallback',
  ];
}

/**
 * Determine if we're running on iOS (iPhone, iPad, iPod)
 */
export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua);
}

/**
 * Determine if we're running on Android
 */
export function isAndroidDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android/i.test(ua);
}

/**
 * Check if the current environment supports full wallet mode
 */
export function supportsFullWallet(): boolean {
  try {
    if (typeof SharedArrayBuffer === 'undefined') return false;
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) return false;
    
    // Quick functional test
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.store(view, 0, 42);
    return Atomics.load(view, 0) === 42;
  } catch {
    return false;
  }
}

/**
 * Get a user-friendly message about the current wallet mode
 */
export function getWalletModeMessage(): { mode: WalletMode; title: string; description: string } {
  const browser = detectBrowser();
  
  if (browser.isSupported) {
    return {
      mode: 'full',
      title: 'Full Wallet Mode',
      description: 'All features available including Zcash wallet sync and local proof generation.',
    };
  }
  
  if (browser.isMobile) {
    return {
      mode: 'lite',
      title: 'Lite Mode (Mobile)',
      description: 'P2P trading, proof verification, and messaging work on mobile. Full wallet sync requires a desktop browser.',
    };
  }
  
  if (browser.name === 'Safari') {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      return {
        mode: 'lite',
        title: 'Lite Mode (Safari Dev)',
        description: 'Safari on localhost needs proper server headers for full wallet. Use Chrome/Firefox for local dev, or run "npm run preview".',
      };
    }
  }
  
  return {
    mode: 'lite',
    title: 'Lite Mode',
    description: 'P2P marketplace, proof verification, and messaging are available. For full wallet sync, use Chrome, Firefox, or Edge.',
  };
}

