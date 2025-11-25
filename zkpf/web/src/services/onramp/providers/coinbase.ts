/**
 * Coinbase Onramp Provider Adapter
 * 
 * Integrates with Coinbase's Onramp SDK for zero-fee USDC purchases.
 * Documentation: https://docs.cdp.coinbase.com/onramp/docs/overview
 */

import {
  type OnRampProviderAdapter,
  type ProviderCapabilities,
  type GetQuoteRequest,
  type OnRampQuote,
  type StartOnRampRequest,
  type StartOnRampResponse,
  type OnRampSession,
  PROVIDER_CAPABILITIES,
} from '../types';

/**
 * Coinbase chain identifier mapping.
 */
const COINBASE_CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  polygon: 'polygon',
  avalanche: 'avalanche-c-chain',
};

/**
 * Coinbase Onramp configuration.
 */
export interface CoinbaseOnrampConfig {
  /** Coinbase CDP App ID */
  appId: string;
  /** App name for display */
  appName?: string;
  /** Logo URL for display in Coinbase widget */
  appLogoUrl?: string;
}

/**
 * Coinbase Onramp provider adapter.
 */
export class CoinbaseOnrampAdapter implements OnRampProviderAdapter {
  readonly provider = 'coinbase' as const;
  private config: CoinbaseOnrampConfig;
  private sessions: Map<string, OnRampSession> = new Map();

  constructor(config: CoinbaseOnrampConfig) {
    this.config = config;
  }

  getCapabilities(): ProviderCapabilities {
    return PROVIDER_CAPABILITIES.coinbase;
  }

  isAvailable(chain: string, country?: string): boolean {
    const capabilities = this.getCapabilities();
    
    // Check chain support
    if (!capabilities.supportedChains.includes(chain)) {
      return false;
    }
    
    // Check country support (if provided)
    if (country && !capabilities.supportedCountries.includes(country)) {
      return false;
    }
    
    return true;
  }

  async getQuote(request: GetQuoteRequest): Promise<OnRampQuote> {
    // Coinbase offers zero-fee USDC, so the quote is straightforward
    const amountCents = Math.round(request.amountUsd * 100);
    
    // USDC is 1:1 with USD (minus any minor spread)
    const cryptoAmount = request.amountUsd * 1_000_000; // 6 decimals
    
    return {
      provider: 'coinbase',
      fiatAmountCents: amountCents,
      fiatCurrency: 'USD',
      cryptoAmount,
      cryptoAsset: 'USDC',
      exchangeRate: 1.0,
      fees: {
        provider: 0, // Zero fee for USDC!
        network: 0,  // Coinbase covers gas
        total: 0,
      },
      estimatedTimeSeconds: 300, // ~5 minutes
      expiresAt: Date.now() + 300_000, // 5 minute quote validity
      isZeroFee: true,
    };
  }

  async startSession(request: StartOnRampRequest): Promise<StartOnRampResponse> {
    const quote = await this.getQuote({
      chain: request.chain,
      amountUsd: request.amountUsd,
      userCountry: request.userCountry,
    });

    const sessionId = this.generateSessionId();
    const now = Date.now();

    const session: OnRampSession = {
      id: sessionId,
      provider: 'coinbase',
      status: 'pending',
      fiatAmountCents: Math.round(request.amountUsd * 100),
      fiatCurrency: 'USD',
      cryptoAmount: quote.cryptoAmount,
      cryptoAsset: 'USDC',
      targetChain: request.chain,
      targetAddress: request.address,
      createdAt: now,
    };

    const redirectUrl = this.generateRedirectUrl(session);
    session.redirectUrl = redirectUrl;

    this.sessions.set(sessionId, session);

    return {
      session,
      redirectUrl,
      quote,
    };
  }

  async getSessionStatus(sessionId: string): Promise<OnRampSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  generateRedirectUrl(session: OnRampSession): string {
    const coinbaseChain = COINBASE_CHAIN_MAP[session.targetChain];
    if (!coinbaseChain) {
      throw new Error(`Unsupported chain for Coinbase: ${session.targetChain}`);
    }

    // Build Coinbase Onramp URL
    // See: https://docs.cdp.coinbase.com/onramp/docs/api-generating-onramp-url
    const params = new URLSearchParams({
      appId: this.config.appId,
      destinationWallets: JSON.stringify([{
        address: session.targetAddress,
        blockchains: [coinbaseChain],
        assets: ['USDC'],
      }]),
      defaultAsset: 'USDC',
      presetFiatAmount: String(session.fiatAmountCents / 100),
      fiatCurrency: 'USD',
    });

    // Add optional parameters
    if (this.config.appName) {
      params.set('partnerName', this.config.appName);
    }
    if (this.config.appLogoUrl) {
      params.set('partnerLogoUrl', this.config.appLogoUrl);
    }

    // Add session ID for tracking
    params.set('sessionToken', session.id);

    return `https://pay.coinbase.com/buy/select-asset?${params.toString()}`;
  }

  /**
   * Update session status (called by webhook handler).
   */
  updateSession(sessionId: string, updates: Partial<OnRampSession>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      if (updates.status === 'completed') {
        session.completedAt = Date.now();
      }
    }
  }

  private generateSessionId(): string {
    return `cb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

/**
 * Create a Coinbase Onramp adapter instance.
 */
export function createCoinbaseAdapter(config: CoinbaseOnrampConfig): CoinbaseOnrampAdapter {
  return new CoinbaseOnrampAdapter(config);
}

/**
 * Validate Coinbase webhook signature using HMAC-SHA256.
 * See: https://docs.cdp.coinbase.com/onramp/docs/webhooks
 * 
 * @param payload - Raw request body as string
 * @param signature - Value from X-CC-Webhook-Signature header
 * @param webhookSecret - Your webhook shared secret from Coinbase
 * @returns Promise<boolean> - True if signature is valid
 */
export async function validateCoinbaseWebhook(
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<boolean> {
  if (!signature || !webhookSecret || !payload) {
    return false;
  }

  try {
    // Convert secret and payload to Uint8Array for Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhookSecret);
    const payloadData = encoder.encode(payload);

    // Import the secret key for HMAC-SHA256
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Generate the expected signature
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      payloadData
    );

    // Convert to hex string
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Compare signatures using constant-time comparison to prevent timing attacks
    return constantTimeCompare(signature.toLowerCase(), expectedSignature.toLowerCase());
  } catch (error) {
    console.error('Webhook signature validation failed:', error);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Parse Coinbase webhook payload.
 */
export interface CoinbaseWebhookEvent {
  type: 'charge:created' | 'charge:confirmed' | 'charge:failed' | 'charge:pending';
  data: {
    id: string;
    code: string;
    pricing: {
      local: { amount: string; currency: string };
      crypto: { amount: string; currency: string };
    };
    addresses: Record<string, string>;
    metadata: {
      sessionToken?: string;
    };
    timeline: Array<{
      time: string;
      status: string;
    }>;
  };
}

export function parseCoinbaseWebhook(payload: string): CoinbaseWebhookEvent {
  return JSON.parse(payload) as CoinbaseWebhookEvent;
}

