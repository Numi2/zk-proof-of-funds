/**
 * On-Ramp Service Types
 * 
 * Type definitions for the USDC on-ramp integration.
 */

import type { OnRampProvider as OnRampProviderType } from '../../config/usdc-chains';

// Re-export OnRampProvider for convenience
export type OnRampProvider = OnRampProviderType;

/**
 * Status of an on-ramp session.
 */
export type OnRampStatus = 
  | 'idle'        // No session started
  | 'pending'     // Session created, awaiting user action
  | 'processing'  // User completed action, transaction in progress
  | 'completed'   // USDC successfully delivered
  | 'failed'      // Transaction failed
  | 'expired';    // Session timed out

/**
 * Payment method types supported by on-ramp providers.
 */
export type PaymentMethod = 
  | 'card'           // Credit/debit card
  | 'bank_transfer'  // ACH, SEPA, etc.
  | 'apple_pay'      // Apple Pay
  | 'google_pay'     // Google Pay
  | 'cash';          // Cash deposit (MoneyGram)

/**
 * Represents an active on-ramp session.
 */
export interface OnRampSession {
  /** Unique session identifier */
  id: string;
  /** On-ramp provider handling this session */
  provider: OnRampProvider;
  /** Current session status */
  status: OnRampStatus;
  /** Fiat amount in cents (e.g., 10000 = $100.00) */
  fiatAmountCents: number;
  /** Fiat currency code (e.g., 'USD', 'EUR') */
  fiatCurrency: string;
  /** Expected crypto amount (6 decimals for USDC) */
  cryptoAmount?: number;
  /** Crypto asset symbol (always 'USDC' for now) */
  cryptoAsset: string;
  /** Target blockchain for delivery */
  targetChain: string;
  /** Destination wallet address */
  targetAddress: string;
  /** Transaction hash once available */
  txHash?: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Timestamp when session completed */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
  /** Provider-specific session URL (for redirect) */
  redirectUrl?: string;
}

/**
 * Quote for a potential on-ramp transaction.
 */
export interface OnRampQuote {
  /** Provider offering this quote */
  provider: OnRampProvider;
  /** Fiat amount in cents */
  fiatAmountCents: number;
  /** Fiat currency code */
  fiatCurrency: string;
  /** Crypto amount to receive (6 decimals for USDC) */
  cryptoAmount: number;
  /** Crypto asset symbol */
  cryptoAsset: string;
  /** Exchange rate (fiat per crypto) */
  exchangeRate: number;
  /** Fee breakdown */
  fees: {
    /** Provider fee in cents */
    provider: number;
    /** Network/gas fee in cents */
    network: number;
    /** Total fees in cents */
    total: number;
  };
  /** Estimated time to completion in seconds */
  estimatedTimeSeconds: number;
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Whether this quote includes zero fees (e.g., Coinbase USDC) */
  isZeroFee: boolean;
}

/**
 * Request to start an on-ramp session.
 */
export interface StartOnRampRequest {
  /** Preferred provider (or let system choose) */
  provider?: OnRampProvider;
  /** Target chain for USDC delivery */
  chain: string;
  /** Destination wallet address */
  address: string;
  /** Fiat amount in dollars (e.g., 100 = $100) */
  amountUsd: number;
  /** Preferred payment method */
  paymentMethod?: PaymentMethod;
  /** User's country code for provider selection */
  userCountry?: string;
}

/**
 * Response from starting an on-ramp session.
 */
export interface StartOnRampResponse {
  /** Created session */
  session: OnRampSession;
  /** URL to redirect user to provider */
  redirectUrl: string;
  /** Quote for this transaction */
  quote: OnRampQuote;
}

/**
 * Request to get a quote without starting a session.
 */
export interface GetQuoteRequest {
  /** Target chain for USDC delivery */
  chain: string;
  /** Fiat amount in dollars */
  amountUsd: number;
  /** User's country code for availability check */
  userCountry?: string;
}

/**
 * Response containing quotes from available providers.
 */
export interface GetQuoteResponse {
  /** Quotes from all available providers, sorted by best value */
  quotes: OnRampQuote[];
  /** Recommended quote (best value) */
  recommended: OnRampQuote;
  /** Providers not available and why */
  unavailable: {
    provider: OnRampProvider;
    reason: string;
  }[];
}

/**
 * Webhook payload from on-ramp providers.
 */
export interface OnRampWebhookPayload {
  /** Session ID this webhook relates to */
  sessionId: string;
  /** New status */
  status: OnRampStatus;
  /** Transaction hash if completed */
  txHash?: string;
  /** Actual crypto amount delivered */
  cryptoAmount?: number;
  /** Error message if failed */
  error?: string;
  /** Provider-specific metadata */
  providerData?: Record<string, unknown>;
}

/**
 * Configuration for the on-ramp service.
 */
export interface OnRampConfig {
  /** Default provider to use */
  defaultProvider: OnRampProvider;
  /** Default chain for USDC delivery */
  defaultChain: string;
  /** Enabled providers */
  enabledProviders: OnRampProvider[];
  /** Enabled chains for on-ramp */
  enabledChains: string[];
  /** Minimum purchase amount in USD */
  minAmountUsd: number;
  /** Maximum purchase amount in USD */
  maxAmountUsd: number;
  /** Session timeout in seconds */
  sessionTimeoutSeconds: number;
}

/**
 * Provider capabilities and requirements.
 */
export interface ProviderCapabilities {
  /** Provider identifier */
  provider: OnRampProvider;
  /** Display name */
  displayName: string;
  /** Chains supported by this provider */
  supportedChains: string[];
  /** Countries where this provider is available */
  supportedCountries: string[];
  /** Payment methods accepted */
  paymentMethods: PaymentMethod[];
  /** Fee structure */
  fees: {
    /** Percentage fee (0 for zero-fee USDC) */
    percentage: number;
    /** Fixed fee in cents */
    fixedCents: number;
  };
  /** Whether KYC is required */
  kycRequired: boolean;
  /** Minimum purchase in USD */
  minAmountUsd: number;
  /** Maximum purchase in USD */
  maxAmountUsd: number;
  /** Average processing time in seconds */
  avgProcessingTimeSeconds: number;
}

/**
 * Event types emitted by the on-ramp service.
 */
export type OnRampEvent =
  | { type: 'SESSION_CREATED'; session: OnRampSession }
  | { type: 'SESSION_UPDATED'; session: OnRampSession }
  | { type: 'QUOTE_RECEIVED'; quote: OnRampQuote }
  | { type: 'TRANSACTION_SUBMITTED'; txHash: string }
  | { type: 'TRANSACTION_CONFIRMED'; session: OnRampSession }
  | { type: 'ERROR'; error: string; sessionId?: string };

/**
 * Callback for on-ramp events.
 */
export type OnRampEventHandler = (event: OnRampEvent) => void;

/**
 * Interface for on-ramp provider adapters.
 */
export interface OnRampProviderAdapter {
  /** Provider identifier */
  readonly provider: OnRampProvider;
  
  /** Get provider capabilities */
  getCapabilities(): ProviderCapabilities;
  
  /** Check if provider is available for given params */
  isAvailable(chain: string, country?: string): boolean;
  
  /** Get a quote for the transaction */
  getQuote(request: GetQuoteRequest): Promise<OnRampQuote>;
  
  /** Start an on-ramp session */
  startSession(request: StartOnRampRequest): Promise<StartOnRampResponse>;
  
  /** Get session status */
  getSessionStatus(sessionId: string): Promise<OnRampSession>;
  
  /** Generate the URL to redirect user to provider */
  generateRedirectUrl(session: OnRampSession): string;
}

/**
 * Default on-ramp configuration.
 */
export const DEFAULT_ONRAMP_CONFIG: OnRampConfig = {
  defaultProvider: 'coinbase',
  defaultChain: 'base',
  enabledProviders: ['coinbase', 'transak'],
  enabledChains: ['base', 'ethereum', 'arbitrum', 'optimism', 'polygon', 'starknet'],
  minAmountUsd: 10,
  maxAmountUsd: 10000,
  sessionTimeoutSeconds: 3600, // 1 hour
};

/**
 * Known provider capabilities.
 */
export const PROVIDER_CAPABILITIES: Record<OnRampProvider, ProviderCapabilities> = {
  coinbase: {
    provider: 'coinbase',
    displayName: 'Coinbase',
    supportedChains: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'avalanche'],
    supportedCountries: ['US', 'UK', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE'], // Partial list
    paymentMethods: ['card', 'bank_transfer', 'apple_pay', 'google_pay'],
    fees: { percentage: 0, fixedCents: 0 }, // Zero fee for USDC!
    kycRequired: true,
    minAmountUsd: 10,
    maxAmountUsd: 10000,
    avgProcessingTimeSeconds: 300, // ~5 minutes
  },
  transak: {
    provider: 'transak',
    displayName: 'Transak',
    supportedChains: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'starknet', 'avalanche'],
    supportedCountries: ['*'], // 100+ countries
    paymentMethods: ['card', 'bank_transfer', 'apple_pay', 'google_pay'],
    fees: { percentage: 1, fixedCents: 0 },
    kycRequired: true, // Tiered
    minAmountUsd: 30,
    maxAmountUsd: 5000,
    avgProcessingTimeSeconds: 600, // ~10 minutes
  },
  moneygram: {
    provider: 'moneygram',
    displayName: 'MoneyGram',
    supportedChains: ['ethereum'], // Via Stellar bridge
    supportedCountries: ['US', 'MX', 'CO', 'GT', 'SV', 'HN', 'NI'],
    paymentMethods: ['cash'],
    fees: { percentage: 2, fixedCents: 299 },
    kycRequired: true,
    minAmountUsd: 50,
    maxAmountUsd: 2500,
    avgProcessingTimeSeconds: 1800, // ~30 minutes (includes physical visit)
  },
};

