/**
 * Transak On-ramp Provider Adapter
 * 
 * Integrates with Transak's widget and API for fiat-to-crypto purchases.
 * Documentation: https://docs.transak.com/
 * 
 * Transak offers:
 * - 100+ countries support
 * - Multiple payment methods (card, bank, Apple Pay, Google Pay)
 * - Direct Starknet support
 * - ~1% fee on most transactions
 */

import {
  type OnRampProviderAdapter,
  type ProviderCapabilities,
  type GetQuoteRequest,
  type OnRampQuote,
  type StartOnRampRequest,
  type StartOnRampResponse,
  type OnRampSession,
  type OnRampStatus,
  PROVIDER_CAPABILITIES,
} from '../types';

/**
 * Transak network identifier mapping.
 */
const TRANSAK_NETWORK_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  polygon: 'polygon',
  starknet: 'starknet',
  avalanche: 'avaxcchain',
};

/**
 * Transak environment configuration.
 */
export interface TransakConfig {
  /** Transak API key */
  apiKey: string;
  /** Environment (STAGING or PRODUCTION) */
  environment: 'STAGING' | 'PRODUCTION';
  /** Partner ID for tracking */
  partnerId?: string;
  /** Webhook secret for signature validation */
  webhookSecret?: string;
}

/**
 * Transak API response types
 */
interface TransakPriceResponse {
  response: {
    fiatAmount: number;
    fiatCurrency: string;
    cryptoAmount: number;
    cryptoCurrency: string;
    conversionPrice: number;
    totalFee: number;
    feeBreakdown: {
      networkFee: number;
      transakFee: number;
      partnerFee: number;
    };
  };
  error?: {
    message: string;
  };
}

interface TransakOrderResponse {
  response: {
    id: string;
    status: string;
    fiatAmount: number;
    fiatCurrency: string;
    cryptoAmount: number;
    cryptoCurrency: string;
    walletAddress: string;
    network: string;
    transactionHash?: string;
    redirectURL?: string;
    createdAt: string;
    completedAt?: string;
  };
  error?: {
    message: string;
  };
}

/**
 * Transak order status mapping to OnRampStatus.
 */
const STATUS_MAP: Record<string, OnRampStatus> = {
  'AWAITING_PAYMENT_FROM_USER': 'pending',
  'PAYMENT_DONE_MARKED_BY_USER': 'pending',
  'PROCESSING': 'processing',
  'PENDING_DELIVERY_FROM_TRANSAK': 'processing',
  'ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK': 'processing',
  'COMPLETED': 'completed',
  'CANCELLED': 'failed',
  'FAILED': 'failed',
  'REFUNDED': 'failed',
  'EXPIRED': 'expired',
};

/**
 * Transak on-ramp provider adapter.
 */
export class TransakOnrampAdapter implements OnRampProviderAdapter {
  readonly provider = 'transak' as const;
  private config: TransakConfig;
  private sessions: Map<string, OnRampSession> = new Map();

  constructor(config: TransakConfig) {
    this.config = config;
  }

  /**
   * Get the base API URL based on environment.
   */
  private get apiBaseUrl(): string {
    return this.config.environment === 'PRODUCTION'
      ? 'https://api.transak.com'
      : 'https://staging-api.transak.com';
  }

  /**
   * Get the widget URL based on environment.
   */
  private get widgetBaseUrl(): string {
    return this.config.environment === 'PRODUCTION'
      ? 'https://global.transak.com'
      : 'https://staging-global.transak.com';
  }

  getCapabilities(): ProviderCapabilities {
    return PROVIDER_CAPABILITIES.transak;
  }

  isAvailable(chain: string, _country?: string): boolean {
    const capabilities = this.getCapabilities();
    
    // Check chain support
    if (!capabilities.supportedChains.includes(chain)) {
      return false;
    }
    
    // Transak supports 100+ countries, so we default to available
    // In production, you might want to call their /countries API
    return true;
  }

  /**
   * Get a quote from Transak's pricing API.
   */
  async getQuote(request: GetQuoteRequest): Promise<OnRampQuote> {
    const network = TRANSAK_NETWORK_MAP[request.chain];
    if (!network) {
      throw new Error(`Unsupported chain for Transak: ${request.chain}`);
    }

    try {
      // Call Transak's price API
      const response = await fetch(
        `${this.apiBaseUrl}/api/v2/currencies/price?` + new URLSearchParams({
          fiatCurrency: 'USD',
          cryptoCurrency: 'USDC',
          network: network,
          fiatAmount: String(request.amountUsd),
          isBuyOrSell: 'BUY',
          paymentMethod: 'credit_debit_card',
        }),
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        // Fallback to estimated quote if API fails
        return this.getEstimatedQuote(request);
      }

      const data: TransakPriceResponse = await response.json();
      
      if (data.error) {
        // Fallback to estimated quote
        return this.getEstimatedQuote(request);
      }

      const priceData = data.response;
      const amountCents = Math.round(priceData.fiatAmount * 100);
      
      // USDC has 6 decimals
      const cryptoAmount = priceData.cryptoAmount * 1_000_000;
      
      return {
        provider: 'transak',
        fiatAmountCents: amountCents,
        fiatCurrency: priceData.fiatCurrency,
        cryptoAmount,
        cryptoAsset: 'USDC',
        exchangeRate: priceData.conversionPrice,
        fees: {
          provider: Math.round(priceData.feeBreakdown.transakFee * 100),
          network: Math.round(priceData.feeBreakdown.networkFee * 100),
          total: Math.round(priceData.totalFee * 100),
        },
        estimatedTimeSeconds: 600, // ~10 minutes average
        expiresAt: Date.now() + 300_000, // 5 minute quote validity
        isZeroFee: false,
      };
    } catch (error) {
      // Fallback to estimated quote on network errors
      console.warn('Transak API error, using estimated quote:', error);
      return this.getEstimatedQuote(request);
    }
  }

  /**
   * Get an estimated quote when API is unavailable.
   * Uses Transak's typical fee structure: ~1% + network fees
   */
  private getEstimatedQuote(request: GetQuoteRequest): OnRampQuote {
    const amountCents = Math.round(request.amountUsd * 100);
    
    // Transak typically charges ~1% fee
    const feePercent = 0.01;
    const networkFeeCents = 50; // ~$0.50 network fee estimate
    
    const providerFeeCents = Math.round(amountCents * feePercent);
    const totalFeeCents = providerFeeCents + networkFeeCents;
    const netAmountCents = amountCents - totalFeeCents;
    
    // USDC is 1:1 with USD, 6 decimals
    const cryptoAmount = (netAmountCents / 100) * 1_000_000;
    
    return {
      provider: 'transak',
      fiatAmountCents: amountCents,
      fiatCurrency: 'USD',
      cryptoAmount,
      cryptoAsset: 'USDC',
      exchangeRate: 1.0,
      fees: {
        provider: providerFeeCents,
        network: networkFeeCents,
        total: totalFeeCents,
      },
      estimatedTimeSeconds: 600,
      expiresAt: Date.now() + 300_000,
      isZeroFee: false,
    };
  }

  /**
   * Start a Transak session by generating the widget URL.
   */
  async startSession(request: StartOnRampRequest): Promise<StartOnRampResponse> {
    const network = TRANSAK_NETWORK_MAP[request.chain];
    if (!network) {
      throw new Error(`Unsupported chain for Transak: ${request.chain}`);
    }

    const quote = await this.getQuote({
      chain: request.chain,
      amountUsd: request.amountUsd,
      userCountry: request.userCountry,
    });

    const sessionId = this.generateSessionId();
    const now = Date.now();

    const session: OnRampSession = {
      id: sessionId,
      provider: 'transak',
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

  /**
   * Get the current status of a session.
   * In production, this would query Transak's order status API.
   */
  async getSessionStatus(sessionId: string): Promise<OnRampSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // If session is terminal, return cached state
    if (['completed', 'failed', 'expired'].includes(session.status)) {
      return session;
    }

    // Try to get status from Transak API
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/api/v2/partner/order/${sessionId}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'x-partner-api-key': this.config.apiKey,
          },
        }
      );

      if (response.ok) {
        const data: TransakOrderResponse = await response.json();
        if (data.response) {
          const order = data.response;
          session.status = STATUS_MAP[order.status] || 'processing';
          if (order.transactionHash) {
            session.txHash = order.transactionHash;
          }
          if (order.completedAt) {
            session.completedAt = new Date(order.completedAt).getTime();
          }
          this.sessions.set(sessionId, session);
        }
      }
    } catch (error) {
      console.warn('Failed to fetch Transak order status:', error);
      // Continue with cached session
    }

    return session;
  }

  /**
   * Generate the Transak widget URL with all required parameters.
   */
  generateRedirectUrl(session: OnRampSession): string {
    const network = TRANSAK_NETWORK_MAP[session.targetChain];
    if (!network) {
      throw new Error(`Unsupported chain for Transak: ${session.targetChain}`);
    }

    const params = new URLSearchParams({
      apiKey: this.config.apiKey,
      environment: this.config.environment,
      cryptoCurrencyCode: 'USDC',
      network: network,
      walletAddress: session.targetAddress,
      fiatAmount: String(session.fiatAmountCents / 100),
      fiatCurrency: 'USD',
      defaultPaymentMethod: 'credit_debit_card',
      disableWalletAddressForm: 'true',
      hideMenu: 'true',
      themeColor: '22c55e', // Green theme to match zkpf branding
      // Pass session ID for webhook correlation
      partnerOrderId: session.id,
    });

    // Add partner ID if configured
    if (this.config.partnerId) {
      params.set('partnerCustomerId', this.config.partnerId);
    }

    return `${this.widgetBaseUrl}?${params.toString()}`;
  }

  /**
   * Update session status from webhook.
   */
  updateSession(sessionId: string, updates: Partial<OnRampSession>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      if (updates.status === 'completed') {
        session.completedAt = Date.now();
      }
      this.sessions.set(sessionId, session);
    }
  }

  private generateSessionId(): string {
    return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

/**
 * Create a Transak adapter instance.
 */
export function createTransakAdapter(config: TransakConfig): TransakOnrampAdapter {
  return new TransakOnrampAdapter(config);
}

/**
 * Transak webhook event types.
 */
export interface TransakWebhookEvent {
  webhookData: {
    id: string;
    status: string;
    fiatCurrency: string;
    fiatAmount: number;
    cryptoCurrency: string;
    cryptoAmount: number;
    network: string;
    walletAddress: string;
    transactionHash?: string;
    partnerOrderId?: string;
    createdAt: string;
    completedAt?: string;
  };
}

/**
 * Validate Transak webhook signature using HMAC-SHA256.
 * 
 * @param payload - Raw request body as string
 * @param signature - Value from X-WEBHOOK-SIGNATURE header
 * @param webhookSecret - Your webhook secret from Transak dashboard
 * @returns Promise<boolean> - True if signature is valid
 */
export async function validateTransakWebhook(
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<boolean> {
  if (!signature || !webhookSecret || !payload) {
    return false;
  }

  try {
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

    // Constant-time comparison
    return constantTimeCompare(signature.toLowerCase(), expectedSignature.toLowerCase());
  } catch (error) {
    console.error('Transak webhook signature validation failed:', error);
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
 * Parse Transak webhook payload.
 */
export function parseTransakWebhook(payload: string): TransakWebhookEvent {
  return JSON.parse(payload) as TransakWebhookEvent;
}

/**
 * Map Transak webhook status to OnRampStatus.
 */
export function mapTransakStatus(transakStatus: string): OnRampStatus {
  return STATUS_MAP[transakStatus] || 'processing';
}

