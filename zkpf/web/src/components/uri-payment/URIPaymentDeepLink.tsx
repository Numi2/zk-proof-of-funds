import { useEffect, useState, useCallback } from 'react';
import { isPaymentUri, parsePaymentUri } from './utils';
import type { UriPayment } from './types';

interface URIPaymentDeepLinkProps {
  onPaymentDetected: (payment: UriPayment) => void;
  children?: React.ReactNode;
}

/**
 * Deep link handler for URI-Encapsulated Payments
 * 
 * This component handles incoming payment URIs from:
 * 1. URL hash on page load
 * 2. URL changes during navigation
 * 3. Message events from other windows/iframes
 * 4. Custom URL scheme handlers (if registered)
 */
export function URIPaymentDeepLink({ onPaymentDetected, children }: URIPaymentDeepLinkProps) {

  // Check for payment URI in the current URL
  const checkCurrentUrl = useCallback(() => {
    const fullUrl = window.location.href;
    
    // Check if the URL itself is a payment URI
    if (isPaymentUri(fullUrl)) {
      const payment = parsePaymentUri(fullUrl);
      if (payment) {
        onPaymentDetected(payment);
        // Clear the URL to prevent re-processing
        window.history.replaceState(null, '', window.location.pathname);
        return true;
      }
    }
    
    // Check the hash separately (for fragment-only redirects)
    const hash = window.location.hash;
    if (hash && hash.includes('amount=') && hash.includes('key=')) {
      // Reconstruct potential URI from hash
      const potentialUri = `https://pay.withzcash.com:65536/v1${hash}`;
      if (isPaymentUri(potentialUri)) {
        const payment = parsePaymentUri(potentialUri);
        if (payment) {
          onPaymentDetected(payment);
          window.history.replaceState(null, '', window.location.pathname);
          return true;
        }
      }
    }
    
    return false;
  }, [onPaymentDetected]);

  // Check URL on mount
  useEffect(() => {
    checkCurrentUrl();
  }, [checkCurrentUrl]);

  // Listen for hashchange events
  useEffect(() => {
    const handleHashChange = () => {
      checkCurrentUrl();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [checkCurrentUrl]);

  // Listen for popstate events (back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      checkCurrentUrl();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [checkCurrentUrl]);

  // Listen for messages from other windows/iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin if needed
      // For security, you might want to restrict this to known origins
      
      if (typeof event.data === 'string' && isPaymentUri(event.data)) {
        const payment = parsePaymentUri(event.data);
        if (payment) {
          onPaymentDetected(payment);
        }
      } else if (event.data && typeof event.data === 'object' && event.data.type === 'zcash-payment-uri') {
        const uri = event.data.uri;
        if (typeof uri === 'string' && isPaymentUri(uri)) {
          const payment = parsePaymentUri(uri);
          if (payment) {
            onPaymentDetected(payment);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onPaymentDetected]);

  return <>{children}</>;
}

/**
 * Hook to detect and handle payment URIs
 */
export function usePaymentUri(): {
  pendingPayment: UriPayment | null;
  clearPendingPayment: () => void;
  checkForPayment: (input: string) => UriPayment | null;
} {
  const [pendingPayment, setPendingPayment] = useState<UriPayment | null>(null);

  const clearPendingPayment = useCallback(() => {
    setPendingPayment(null);
  }, []);

  const checkForPayment = useCallback((input: string): UriPayment | null => {
    if (isPaymentUri(input)) {
      const payment = parsePaymentUri(input);
      if (payment) {
        setPendingPayment(payment);
        return payment;
      }
    }
    return null;
  }, []);

  // Check URL on mount
  useEffect(() => {
    const fullUrl = window.location.href;
    if (isPaymentUri(fullUrl)) {
      const payment = parsePaymentUri(fullUrl);
      if (payment) {
        setPendingPayment(payment);
        // Clear the URL
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  return { pendingPayment, clearPendingPayment, checkForPayment };
}

/**
 * Register as a handler for zcash: URIs
 * This is best-effort and may not work in all browsers/contexts
 */
export function registerProtocolHandler(): boolean {
  try {
    if ('registerProtocolHandler' in navigator) {
      // Note: This requires user interaction and may show a prompt
      // The URL template must include %s which will be replaced with the URI
      const handlerUrl = `${window.location.origin}/receive?uri=%s`;
      
      // Try to register (may fail silently or show a prompt)
      navigator.registerProtocolHandler(
        'web+zcash',
        handlerUrl
      );
      
      return true;
    }
  } catch (e) {
    console.warn('Failed to register protocol handler:', e);
  }
  return false;
}

/**
 * Check if this app is registered as a protocol handler
 */
export function isProtocolHandlerRegistered(): boolean {
  // There's no reliable way to check this, so we just return false
  // The browser will handle showing the appropriate prompts
  return false;
}

