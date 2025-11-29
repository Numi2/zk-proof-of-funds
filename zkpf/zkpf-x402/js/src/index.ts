/**
 * @numi2/x402-zec - x402 Payment Required SDK for Zcash
 * 
 * Accept ZEC payments in your API with the x402 protocol.
 * 
 * @author Numan Thabit
 * @license MIT
 * 
 * @example
 * ```typescript
 * import { X402Client, formatZec, generatePaymentUri } from '@numi2/x402-zec';
 * 
 * const client = new X402Client({
 *   onPaymentRequired: async (req) => {
 *     // Show payment UI and return txid when paid
 *     return await showPaymentDialog(req);
 *   }
 * });
 * 
 * const response = await client.fetch('/api/premium');
 * ```
 */

export interface PaymentRequirements {
  version: string;
  scheme: 'zcash:sapling' | 'zcash:transparent' | 'zcash:unified' | 'zcash:orchard';
  address: string;
  amount_zatoshis: number;
  network: 'mainnet' | 'testnet';
  expires_at: string;
  min_confirmations: number;
  resource: string;
  description?: string;
  payment_id?: string;
  memo?: string;
}

export interface PaymentProof {
  txid: string;
  block_height?: number;
  confirmations?: number;
  output_index?: number;
  payment_id?: string;
}

export interface X402Error {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type PaymentHandler = (requirements: PaymentRequirements) => Promise<string | null>;

export interface X402ClientOptions {
  /**
   * Called when payment is required. Return the txid when payment is complete,
   * or null to abort.
   */
  onPaymentRequired: PaymentHandler;
  
  /**
   * Called when payment is pending (waiting for confirmations)
   */
  onPaymentPending?: (requirements: PaymentRequirements, confirmations: number) => void;
  
  /**
   * Called when an error occurs
   */
  onError?: (error: X402Error) => void;
  
  /**
   * Maximum number of retry attempts after payment
   */
  maxRetries?: number;
  
  /**
   * Delay between retry attempts (ms)
   */
  retryDelay?: number;
  
  /**
   * Custom headers to include in all requests
   */
  headers?: Record<string, string>;
  
  /**
   * Base URL for API calls
   */
  baseUrl?: string;
}

/**
 * x402 HTTP Client
 * 
 * Wraps fetch() to handle 402 Payment Required responses automatically.
 */
export class X402Client {
  private options: Required<X402ClientOptions>;
  
  constructor(options: X402ClientOptions) {
    this.options = {
      onPaymentRequired: options.onPaymentRequired,
      onPaymentPending: options.onPaymentPending || (() => {}),
      onError: options.onError || console.error,
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 2000,
      headers: options.headers ?? {},
      baseUrl: options.baseUrl ?? '',
    };
  }
  
  /**
   * Make an HTTP request with automatic x402 payment handling
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const fullUrl = this.options.baseUrl + url;
    
    // Initial request
    let response = await this.makeRequest(fullUrl, init);
    
    // If not 402, return immediately
    if (response.status !== 402) {
      return response;
    }
    
    // Parse payment requirements
    const requirements = this.parsePaymentRequirements(response);
    if (!requirements) {
      throw new Error('Invalid 402 response: missing payment requirements');
    }
    
    // Request payment from handler
    const txid = await this.options.onPaymentRequired(requirements);
    if (!txid) {
      // User cancelled
      return response;
    }
    
    // Retry with payment proof
    return this.retryWithPayment(fullUrl, init, txid, requirements);
  }
  
  /**
   * Retry a request with a payment proof
   */
  private async retryWithPayment(
    url: string,
    init: RequestInit | undefined,
    txid: string,
    requirements: PaymentRequirements
  ): Promise<Response> {
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      const response = await this.makeRequest(url, init, txid);
      
      // Success!
      if (response.ok) {
        return response;
      }
      
      // Still 402 - check if pending
      if (response.status === 402) {
        const status = response.headers.get('X-Payment-Status');
        if (status?.startsWith('pending:')) {
          const confirmations = parseInt(status.split(':')[1], 10);
          this.options.onPaymentPending(requirements, confirmations);
          
          // Wait and retry
          await this.delay(this.options.retryDelay);
          continue;
        }
        
        // Different payment required? This shouldn't happen
        throw new Error('Payment rejected: ' + await response.text());
      }
      
      // Other error
      throw new Error(`Request failed with status ${response.status}`);
    }
    
    throw new Error('Max retries exceeded waiting for payment confirmation');
  }
  
  /**
   * Make an HTTP request with optional payment proof
   */
  private async makeRequest(
    url: string,
    init?: RequestInit,
    txid?: string
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    
    // Add custom headers
    for (const [key, value] of Object.entries(this.options.headers)) {
      headers.set(key, value);
    }
    
    // Add payment proof if provided
    if (txid) {
      headers.set('X-Payment', txid);
    }
    
    return fetch(url, {
      ...init,
      headers,
    });
  }
  
  /**
   * Parse payment requirements from 402 response
   */
  parsePaymentRequirements(response: Response): PaymentRequirements | null {
    // Try full JSON header first
    const jsonHeader = response.headers.get('X-Payment-Required');
    if (jsonHeader) {
      try {
        return JSON.parse(jsonHeader);
      } catch {
        // Fall through to individual headers
      }
    }
    
    // Parse individual headers
    const address = response.headers.get('X-Payment-Address');
    const amountStr = response.headers.get('X-Payment-Amount');
    
    if (!address || !amountStr) {
      return null;
    }
    
    return {
      version: '1.0',
      scheme: (response.headers.get('X-Payment-Scheme') as PaymentRequirements['scheme']) || 'zcash:sapling',
      address,
      amount_zatoshis: parseInt(amountStr, 10),
      network: (response.headers.get('X-Payment-Network') as 'mainnet' | 'testnet') || 'mainnet',
      expires_at: response.headers.get('X-Payment-Expires') || new Date(Date.now() + 900000).toISOString(),
      min_confirmations: parseInt(response.headers.get('X-Payment-Min-Confirmations') || '1', 10),
      resource: response.headers.get('X-Payment-Resource') || '/',
      description: response.headers.get('X-Payment-Description') || undefined,
      payment_id: response.headers.get('X-Payment-Id') || undefined,
    };
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert zatoshis to ZEC
 */
export function zatoshisToZec(zatoshis: number): number {
  return zatoshis / 100_000_000;
}

/**
 * Convert ZEC to zatoshis
 */
export function zecToZatoshis(zec: number): number {
  return Math.round(zec * 100_000_000);
}

/**
 * Format ZEC amount for display
 */
export function formatZec(zatoshis: number): string {
  const zec = zatoshisToZec(zatoshis);
  if (zec >= 1) {
    return zec.toFixed(2) + ' ZEC';
  } else if (zec >= 0.001) {
    return zec.toFixed(4) + ' ZEC';
  } else {
    return zec.toFixed(8) + ' ZEC';
  }
}

/**
 * Generate a Zcash payment URI for wallet apps
 * 
 * @example
 * ```typescript
 * const uri = generatePaymentUri(requirements);
 * // Opens: zcash:zs1...?amount=0.001&memo=API%20access
 * window.location.href = uri;
 * ```
 */
export function generatePaymentUri(requirements: PaymentRequirements): string {
  const zec = zatoshisToZec(requirements.amount_zatoshis);
  
  let uri = `zcash:${requirements.address}?amount=${zec}`;
  
  if (requirements.memo) {
    uri += `&memo=${encodeURIComponent(requirements.memo)}`;
  } else if (requirements.payment_id) {
    uri += `&memo=${encodeURIComponent(`x402:${requirements.payment_id}`)}`;
  }
  
  if (requirements.description) {
    uri += `&message=${encodeURIComponent(requirements.description)}`;
  }
  
  return uri;
}

/**
 * Check if a transaction ID is valid format
 */
export function isValidTxid(txid: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

/**
 * Check if payment requirements are expired
 */
export function isExpired(requirements: PaymentRequirements): boolean {
  return new Date(requirements.expires_at) < new Date();
}

/**
 * Get time remaining until expiration (in seconds)
 */
export function getTimeRemaining(requirements: PaymentRequirements): number {
  const expiry = new Date(requirements.expires_at).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((expiry - now) / 1000));
}

/**
 * Create payment proof object from transaction ID
 */
export function createPaymentProof(txid: string, options?: Partial<PaymentProof>): PaymentProof {
  return {
    txid: txid.toLowerCase(),
    ...options,
  };
}

// Default export
export default X402Client;

